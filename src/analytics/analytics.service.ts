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
