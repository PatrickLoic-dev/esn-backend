import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePromoBannerDto } from './dto/update-promo-banner.dto';

@Injectable()
export class PromoService {
  constructor(private prisma: PrismaService) {}

  // Single "default" row, created on the fly with defaults (inactive/empty).
  getBanner() {
    return this.prisma.promoBanner.upsert({
      where: { id: 'default' },
      create: {},
      update: {},
    });
  }

  updateBanner(dto: UpdatePromoBannerDto) {
    return this.prisma.promoBanner.upsert({
      where: { id: 'default' },
      create: dto,
      update: dto,
    });
  }
}
