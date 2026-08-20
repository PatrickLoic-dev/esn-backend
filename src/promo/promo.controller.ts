import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PromoService } from './promo.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('promo-codes')
@Controller('promo-codes')
export class PromoController {
  constructor(private promo: PromoService) {}

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreatePromoCodeDto) {
    return this.promo.create(dto);
  }

  // Admin: the full table, including inactive/expired codes.
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admin/all')
  findAllForAdmin() {
    return this.promo.findAllForAdmin();
  }

  // Public: the header's announcement bar reads this on every page load.
  @Public()
  @Get('featured')
  findFeatured() {
    return this.promo.findFeatured();
  }

  // Public: live "Apply" preview at checkout, before the order is placed.
  // The actual discount is always recomputed server-side at order creation —
  // this never trusts a client-supplied amount.
  @Public()
  @Post('validate')
  async validate(@Body('code') code: string) {
    const promo = await this.promo.findValidByCode(code ?? '');
    if (!promo) return { valid: false };
    return {
      valid: true,
      code: promo.code,
      description: promo.description,
      percentOff: promo.percentOff,
      scope: promo.scope,
    };
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromoCodeDto,
  ) {
    return this.promo.update(id, dto);
  }
}
