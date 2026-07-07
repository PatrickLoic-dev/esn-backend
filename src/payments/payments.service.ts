import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  Role,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotchPayClient } from './notchpay.client';
import { MailService } from '../mail/mail.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { JwtPayload } from '../auth/decorators/current-user.decorator';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private notchpay: NotchPayClient,
    private mail: MailService,
  ) {}

  async initiate(user: JwtPayload, dto: InitiatePaymentDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order ${dto.orderId} not found`);
    }
    if (order.userId !== user.sub) {
      throw new ForbiddenException();
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not awaiting payment');
    }

    const reference = `order_${order.id}_${randomUUID().slice(0, 8)}`;
    const init = await this.notchpay.initializePayment({
      // XAF has no minor units — Notch Pay rejects fractional amounts
      amount: Math.round(order.total.toNumber()),
      currency: 'XAF',
      email: user.email,
      phone: dto.phone,
      reference,
      description: `Payment for order ${order.id}`,
    });

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        userId: user.sub,
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
      include: { user: true },
    });
    if (!payment) {
      this.logger.warn(
        `Webhook for unknown payment reference ${transaction.reference}`,
      );
      return { received: true };
    }

    if (event === 'payment.complete') {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.COMPLETE },
        }),
        this.prisma.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.PAID },
        }),
      ]);
      void this.mail.send(
        payment.user.email,
        'Payment confirmed',
        `<p>Your payment of ${payment.amount.toString()} ${payment.currency} for order <b>${payment.orderId}</b> was successful.</p>`,
      );
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
    const where = user.role === Role.ADMIN ? {} : { userId: user.sub };
    return this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }
}
