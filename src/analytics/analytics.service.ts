import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrackEventDto } from './dto/track-event.dto';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  track(dto: TrackEventDto, userId?: string) {
    return this.prisma.analyticsEvent.create({
      data: {
        name: dto.name,
        userId,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
    });
  }

  // Everything the admin dashboard needs, aggregated from the DB
  async dashboard() {
    const since = new Date();
    since.setMonth(since.getMonth() - 5);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const [summary, orders, itemGroups] = await Promise.all([
      this.summary(),
      this.prisma.order.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, total: true, status: true },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
    ]);

    const months: { label: string; revenue: number; orders: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      months.push({
        label: d.toLocaleString('en-US', { month: 'short' }),
        revenue: 0,
        orders: 0,
      });
    }
    const monthIndex = (date: Date) => {
      const now = new Date();
      return (
        5 -
        ((now.getFullYear() - date.getFullYear()) * 12 +
          now.getMonth() -
          date.getMonth())
      );
    };
    for (const o of orders) {
      const idx = monthIndex(o.createdAt);
      if (idx >= 0 && idx < 6) {
        months[idx].orders += 1;
        if (o.status !== OrderStatus.CANCELLED) {
          months[idx].revenue += o.total.toNumber();
        }
      }
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: itemGroups.map((g) => g.productId) } },
      select: { id: true, name: true, price: true },
    });
    const items = await this.prisma.orderItem.findMany({
      where: { productId: { in: itemGroups.map((g) => g.productId) } },
      select: { productId: true, quantity: true, unitPrice: true },
    });
    const topProducts = itemGroups.map((g) => {
      const product = products.find((p) => p.id === g.productId);
      const revenue = items
        .filter((i) => i.productId === g.productId)
        .reduce((s, i) => s + i.unitPrice.toNumber() * i.quantity, 0);
      return {
        productId: g.productId,
        name: product?.name ?? 'Deleted product',
        sales: g._sum.quantity ?? 0,
        revenue,
      };
    });

    return { ...summary, months, topProducts };
  }

  async summary() {
    const [users, orders, revenue, ticketsOpen, topEvents] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.order.count(),
        this.prisma.order.aggregate({
          _sum: { total: true },
          where: { status: { in: [OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DELIVERED] } },
        }),
        this.prisma.ticket.count({ where: { status: 'OPEN' } }),
        this.prisma.analyticsEvent.groupBy({
          by: ['name'],
          _count: { name: true },
          orderBy: { _count: { name: 'desc' } },
          take: 10,
        }),
      ]);

    return {
      totalUsers: users,
      totalOrders: orders,
      totalRevenue: revenue._sum.total ?? 0,
      openTickets: ticketsOpen,
      topEvents: topEvents.map((e) => ({ name: e.name, count: e._count.name })),
    };
  }
}
