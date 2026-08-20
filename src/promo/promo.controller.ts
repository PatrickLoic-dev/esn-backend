import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PromoService } from './promo.service';
import { UpdatePromoBannerDto } from './dto/update-promo-banner.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('promo')
@Controller('promo')
export class PromoController {
  constructor(private promo: PromoService) {}

  // Public: the storefront header reads this on every page load.
  @Public()
  @Get()
  get() {
    return this.promo.getBanner();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch()
  update(@Body() dto: UpdatePromoBannerDto) {
    return this.promo.updateBanner(dto);
  }
}
