import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrackEventDto } from './dto/track-event.dto';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  // Everything the 4-tab Analytics screen needs, aggregated from the DB
  async adminOverview() {
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const start7 = new Date(startToday);
    start7.setDate(start7.getDate() - 6); // last 7 days incl. today
    const startPrev7 = new Date(start7);
    startPrev7.setDate(startPrev7.getDate() - 7);

    const [
      recentOrders,
      prevOrders,
      newCustomers,
      prevNewCustomers,
      categories,
      itemGroups,
      reviews,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: { gte: start7 } },
        select: { total: true, createdAt: true, status: true },
      }),
      this.prisma.order.findMany({
        where: { createdAt: { gte: startPrev7, lt: start7 } },
        select: { total: true, status: true },
      }),
      this.prisma.user.count({
        where: { role: 'CUSTOMER', createdAt: { gte: start7 } },
      }),
      this.prisma.user.count({
        where: {
          role: 'CUSTOMER',
          createdAt: { gte: startPrev7, lt: start7 },
        },
      }),
      this.prisma.category.findMany({
        select: {
          name: true,
          products: {
            select: { orderItems: { select: { quantity: true, unitPrice: true } } },
          },
        },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 8,
      }),
      this.prisma.review.findMany({
        include: {
          product: { select: { name: true } },
          user: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const notCancelled = (o: { status: OrderStatus }) =>
      o.status !== OrderStatus.CANCELLED;

    // --- top stat cards (last 7 days vs previous 7) ---
    const revenue7 = recentOrders
      .filter(notCancelled)
      .reduce((s, o) => s + o.total.toNumber(), 0);
    const revenuePrev = prevOrders
      .filter(notCancelled)
      .reduce((s, o) => s + o.total.toNumber(), 0);
    const orders7 = recentOrders.length;
    const ordersPrev = prevOrders.length;
    const avgOrder = orders7 ? revenue7 / orders7 : 0;
    const avgOrderPrev = ordersPrev ? revenuePrev / ordersPrev : 0;
    const pct = (cur: number, prev: number) =>
      prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;

    // --- daily sales/orders for the 7-day charts ---
    const days: { label: string; revenue: number; orders: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start7);
      d.setDate(start7.getDate() + i);
      days.push({
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        revenue: 0,
        orders: 0,
      });
    }
    for (const o of recentOrders) {
      const idx = Math.floor(
        (o.createdAt.getTime() - start7.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (idx >= 0 && idx < 7) {
        days[idx].orders += 1;
        if (notCancelled(o)) days[idx].revenue += o.total.toNumber();
      }
    }

    // --- sales by category ---
    const byCategory = categories
      .map((c) => ({
        name: c.name,
        revenue: c.products.reduce(
          (s, p) =>
            s +
            p.orderItems.reduce(
              (ps, it) => ps + it.unitPrice.toNumber() * it.quantity,
              0,
            ),
          0,
        ),
      }))
      .sort((a, b) => b.revenue - a.revenue);
    const categoryTotal = byCategory.reduce((s, c) => s + c.revenue, 0);
    const categoryShare = byCategory.map((c) => ({
      ...c,
      share: categoryTotal ? Math.round((c.revenue / categoryTotal) * 100) : 0,
    }));

    // --- top selling products ---
    const products = await this.prisma.product.findMany({
      where: { id: { in: itemGroups.map((g) => g.productId) } },
      select: { id: true, name: true },
    });
    const items = await this.prisma.orderItem.findMany({
      where: { productId: { in: itemGroups.map((g) => g.productId) } },
      select: { productId: true, quantity: true, unitPrice: true },
    });
    const topProducts = itemGroups.map((g) => ({
      name:
        products.find((p) => p.id === g.productId)?.name ?? 'Deleted product',
      sales: g._sum.quantity ?? 0,
      revenue: items
        .filter((i) => i.productId === g.productId)
        .reduce((s, i) => s + i.unitPrice.toNumber() * i.quantity, 0),
    }));

    // --- reviews analytics ---
    const total = reviews.length;
    const sumR = reviews.reduce((s, r) => s + r.rating, 0);
    const distribution = [1, 2, 3, 4, 5].map(
      (star) => reviews.filter((r) => r.rating === star).length,
    );
    const byProductMap = new Map<
      string,
      { name: string; sum: number; count: number }
    >();
    for (const r of reviews) {
      const key = r.product.name;
      const cur = byProductMap.get(key) ?? { name: key, sum: 0, count: 0 };
      cur.sum += r.rating;
      cur.count += 1;
      byProductMap.set(key, cur);
    }
    const reviewData = {
      average: total ? Math.round((sumR / total) * 10) / 10 : 0,
      total,
      positive: reviews.filter((r) => r.rating >= 4).length,
      critical: reviews.filter((r) => r.rating <= 2).length,
      distribution, // [1★,2★,3★,4★,5★] counts
      byProduct: [...byProductMap.values()].map((p) => ({
        name: p.name,
        rating: Math.round((p.sum / p.count) * 10) / 10,
        count: p.count,
      })),
      recent: reviews.slice(0, 6).map((r) => ({
        author:
          [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') ||
          'Anonymous',
        product: r.product.name,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
    };

    return {
      stats: {
        totalRevenue: revenue7,
        totalRevenueDelta: pct(revenue7, revenuePrev),
        totalOrders: orders7,
        totalOrdersDelta: pct(orders7, ordersPrev),
        newCustomers,
        newCustomersDelta: pct(newCustomers, prevNewCustomers),
        avgOrderValue: avgOrder,
        avgOrderValueDelta: pct(avgOrder, avgOrderPrev),
      },
      daily: days,
      byCategory: categoryShare,
      topProducts,
      reviews: reviewData,
    };
  }

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
