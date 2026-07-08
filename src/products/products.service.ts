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

  // Admin: every product, including drafts, with rating + category info
  async findAllForAdmin() {
    const products = await this.prisma.product.findMany({
      include: {
        reviews: { select: { rating: true } },
        category: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return products.map(withRating);
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
