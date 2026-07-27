import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

// Shape returned to the storefront/admin with computed rating fields
function withRating<
  T extends { reviews?: { rating: number }[]; _count?: { reviews: number } },
>(product: T) {
  const reviews = product.reviews ?? [];
  const rating =
    reviews.length > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : 0;
  const { reviews: _omit, ...rest } = product;
  return {
    ...rest,
    rating: Math.round(rating * 10) / 10,
    reviewCount: product._count?.reviews ?? reviews.length,
  };
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateProductDto) {
    return this.prisma.product.create({ data: dto });
  }

  async findAll() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      include: { reviews: { select: { rating: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return products.map(withRating);
  }

  // Admin: every product, including drafts, with rating + category info +
  // a 30-day rotation index (units sold / current stock) for inventory review.
  async findAllForAdmin() {
    const [products, sold] = await Promise.all([
      this.prisma.product.findMany({
        include: {
          reviews: { select: { rating: true } },
          category: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.soldLast30Days(),
    ]);
    return products.map((p) => ({
      ...withRating(p),
      rotationIndex: this.rotationIndex(p, sold.get(p.id) ?? 0),
    }));
  }

  // Units sold per product over the last 30 days (from paid/shipped/delivered
  // order items — cancelled/pending orders don't count as real turnover).
  private async soldLast30Days(): Promise<Map<string, number>> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: { createdAt: { gte: since } } },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.productId, r._sum.quantity ?? 0]));
  }

  // Sales velocity relative to current stock. Not meaningful for
  // made-to-order products (no stock to turn over).
  private rotationIndex(
    product: { fulfilment: string; stock: number },
    unitsSold30d: number,
  ): number | null {
    if (product.fulfilment === 'MADE_TO_ORDER') return null;
    return Math.round((unitsSold30d / Math.max(product.stock, 1)) * 100) / 100;
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { reviews: { select: { rating: true } } },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return withRating(product);
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.ensureExists(id);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async ensureExists(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
  }
}
