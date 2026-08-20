import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PromoCode, PromoScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

@Injectable()
export class PromoService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreatePromoCodeDto) {
    return this.prisma.promoCode.create({
      data: { ...dto, code: normalizeCode(dto.code) },
    });
  }

  // Admin: every code ever created — active, inactive, and expired — so the
  // panel doubles as a history table.
  findAllForAdmin() {
    return this.prisma.promoCode.findMany({
      include: { category: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Public: the single code to feature in the header's announcement bar —
  // the most recently created one that's currently active and in-window.
  findFeatured() {
    const now = new Date();
    return this.prisma.promoCode.findFirst({
      where: {
        active: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdatePromoCodeDto) {
    await this.ensureExists(id);
    return this.prisma.promoCode.update({
      where: { id },
      data: { ...dto, code: dto.code ? normalizeCode(dto.code) : undefined },
    });
  }

  // Resolves + validates a code typed at checkout. Throws nothing — callers
  // decide how to react to `null` (invalid/expired/inactive).
  async findValidByCode(code: string): Promise<PromoCode | null> {
    const now = new Date();
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: normalizeCode(code) },
    });
    if (!promo || !promo.active) return null;
    if (promo.startsAt && promo.startsAt > now) return null;
    if (promo.endsAt && promo.endsAt < now) return null;
    return promo;
  }

  // Whether an order item is covered by this promo's scope.
  isEligible(
    promo: Pick<PromoCode, 'scope' | 'categoryId'>,
    product: { categoryId: string | null; createdAt: Date },
  ): boolean {
    switch (promo.scope) {
      case PromoScope.CATEGORY:
        return product.categoryId === promo.categoryId;
      case PromoScope.NEW_PRODUCTS: {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        return product.createdAt >= thirtyDaysAgo;
      }
      case PromoScope.ORDER:
      default:
        return true;
    }
  }

  discountFor(percentOff: number, eligibleSubtotal: Prisma.Decimal): Prisma.Decimal {
    return eligibleSubtotal.mul(percentOff).div(100);
  }

  private async ensureExists(id: string) {
    const found = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException(`Promo code ${id} not found`);
    }
  }
}
