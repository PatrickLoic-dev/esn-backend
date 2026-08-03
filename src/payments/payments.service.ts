import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotchPayClient } from './notchpay.client';
import { MailService } from '../mail/mail.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { JwtPayload } from '../auth/decorators/current-user.decorator';
import { isStaff } from '../auth/roles.util';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private notchpay: NotchPayClient,
    private mail: MailService,
  ) {}

  async initiate(user: JwtPayload | undefined, dto: InitiatePaymentDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order ${dto.orderId} not found`);
    }
    // A signed-in user may only pay an order that's theirs. Orders with no
    // owner (guest checkout, no matching account) can be paid by whoever has
    // the order id — the same trust model as a one-time payment link.
    if (order.userId && user && order.userId !== user.sub) {
      throw new ForbiddenException();
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not awaiting payment');
    }

    const address = (order.shippingAddress ?? {}) as { email?: string };
    const email = user?.email ?? order.guestEmail ?? address.email;
    if (!email) {
      throw new BadRequestException('No email on file for this order');
    }

    const reference = `order_${order.id}_${randomUUID().slice(0, 8)}`;
    const init = await this.notchpay.initializePayment({
      // XAF has no minor units — Notch Pay rejects fractional amounts
      amount: Math.round(order.total.toNumber()),
      currency: 'XAF',
      email,
      phone: dto.phone,
      reference,
      description: `Payment for order ${order.id}`,
    });

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        userId: order.userId,
        reference: init.transaction.reference,
        method: dto.method,
        amount: order.total,
      },
    });

    return {
      paymentId: payment.id,
      reference: payment.reference,
      // redirect the customer here to complete mobile money or card payment
      authorizationUrl: init.authorization_url,
    };
  }

  // Called by the Notch Pay webhook once signature is verified
  async handleWebhookEvent(event: string, transaction: { reference: string }) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference: transaction.reference },
      include: { user: true, order: true },
    });
    if (!payment) {
      this.logger.warn(
        `Webhook for unknown payment reference ${transaction.reference}`,
      );
      return { received: true };
    }

    if (event === 'payment.complete') {
      // Order.status tracks fulfillment (PENDING -> SHIPPED -> DELIVERED), not
      // payment — payment state lives entirely on the Payment record itself.
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.COMPLETE },
      });
      const address = (payment.order.shippingAddress ?? {}) as {
        email?: string;
      };
      const email = payment.user?.email ?? payment.order.guestEmail ?? address.email;
      if (email) {
        void this.mail.send(
          email,
          'Payment confirmed',
          `<p>Your payment of ${payment.amount.toString()} ${payment.currency} for order <b>${payment.orderId}</b> was successful.</p>`,
        );
      }
    } else if (event === 'payment.failed' || event === 'payment.canceled') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status:
            event === 'payment.failed'
              ? PaymentStatus.FAILED
              : PaymentStatus.CANCELED,
        },
      });
    }
    return { received: true };
  }

  findAllForUser(user: JwtPayload) {
    const where = isStaff(user.role) ? {} : { userId: user.sub };
    return this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Polled by the checkout callback page while waiting for the webhook to
  // land. Guest payments (no owning account) are readable by anyone with the
  // reference — same trust model as the payment link itself.
  async findByReference(reference: string, user: JwtPayload | undefined) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
      include: { order: { select: { userId: true } } },
    });
    if (!payment) {
      throw new NotFoundException(`Payment ${reference} not found`);
    }
    if (
      payment.userId &&
      payment.userId !== user?.sub &&
      !(user && isStaff(user.role))
    ) {
      throw new ForbiddenException();
    }
    const { order, ...rest } = payment;
    return { ...rest, requiresRegistration: !order.userId };
  }
}
