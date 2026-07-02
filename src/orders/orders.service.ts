import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtPayload } from '../auth/decorators/current-user.decorator';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

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

      return tx.order.create({
        data: {
          userId,
          total,
          items: { create: items },
        },
        include: { items: true },
      });
    });
  }

  findAllForUser(user: JwtPayload) {
    const where = user.role === Role.ADMIN ? {} : { userId: user.sub };
    return this.prisma.order.findMany({
      where,
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: { include: { product: true } } },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    if (user.role !== Role.ADMIN && order.userId !== user.sub) {
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
}
