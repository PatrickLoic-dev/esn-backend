import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtPayload } from '../auth/decorators/current-user.decorator';
import { isStaff } from '../auth/roles.util';

const STATUS_MESSAGE: Record<OrderStatus, string> = {
  PENDING: 'has been received and is awaiting payment',
  PAID: 'has been paid and is now being prepared',
  SHIPPED: 'has been shipped and is on its way',
  DELIVERED: 'has been delivered — enjoy!',
  CANCELLED: 'has been cancelled',
};

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async create(userId: string, dto: CreateOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      let total = new Prisma.Decimal(0);
      const items: {
        productId: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
      }[] = [];

      for (const item of dto.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });
        if (!product || !product.isActive) {
          throw new NotFoundException(`Product ${item.productId} not found`);
        }
        if (product.stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product ${product.name}`,
          );
        }
        await tx.product.update({
          where: { id: product.id },
          data: { stock: { decrement: item.quantity } },
        });
        total = total.add(product.price.mul(item.quantity));
        items.push({
          productId: product.id,
          quantity: item.quantity,
          unitPrice: product.price,
        });
      }

      const shippingCost = dto.shippingCost
        ? new Prisma.Decimal(dto.shippingCost)
        : new Prisma.Decimal(0);

      return tx.order.create({
        data: {
          userId,
          total: total.add(shippingCost),
          shippingAddress: (dto.shippingAddress ??
            undefined) as Prisma.InputJsonValue,
          shippingMethod: dto.shippingMethod,
          shippingCost,
          items: { create: items },
        },
        include: { items: true },
      });
    });
  }

  findAllForUser(user: JwtPayload) {
    const where = isStaff(user.role) ? {} : { userId: user.sub };
    return this.prisma.order.findMany({
      where,
      include: {
        items: { include: { product: true } },
        // staff order lists need the customer's identity
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        payments: { orderBy: { createdAt: 'desc' } },
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    if (!isStaff(user.role) && order.userId !== user.sub) {
      throw new ForbiddenException();
    }
    return order;
  }

  async updateStatus(id: string, status: OrderStatus) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return this.prisma.order.update({ where: { id }, data: { status } });
  }

  // Admin: email the customer their current order status
  async notifyCustomer(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { user: { select: { email: true, firstName: true } } },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    const ref = order.id.slice(0, 8).toUpperCase();
    await this.mail.send(
      order.user.email,
      `Update on your order ${ref}`,
      `<p>Hi ${order.user.firstName ?? ''},</p>
       <p>Your order <b>${ref}</b> ${STATUS_MESSAGE[order.status]}.</p>
       <p>Thank you for shopping with Easy Shop Network.</p>`,
    );
    return { sent: true };
  }
}
