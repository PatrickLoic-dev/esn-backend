import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { JwtPayload } from '../auth/decorators/current-user.decorator';

const AUTHOR_SELECT = {
  select: { id: true, firstName: true, lastName: true },
} as const;

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async findByProduct(productId: string) {
    const [reviews, agg] = await Promise.all([
      this.prisma.review.findMany({
        where: { productId },
        include: { user: AUTHOR_SELECT },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);
    return {
      average: Math.round((agg._avg.rating ?? 0) * 10) / 10,
      count: agg._count._all,
      reviews,
    };
  }

  // One review per user and per product (@@unique): a second submission
  // simply updates the existing review instead of failing.
  async upsert(productId: string, user: JwtPayload, dto: CreateReviewDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    return this.prisma.review.upsert({
      where: { productId_userId: { productId, userId: user.sub } },
      create: {
        productId,
        userId: user.sub,
        rating: dto.rating,
        comment: dto.comment,
      },
      update: {
        rating: dto.rating,
        comment: dto.comment,
      },
      include: { user: AUTHOR_SELECT },
    });
  }
}
