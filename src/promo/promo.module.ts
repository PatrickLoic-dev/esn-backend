import { Module } from '@nestjs/common';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';

@Module({
  controllers: [PromoController],
  providers: [PromoService],
  // Exported so Orders can resolve/apply a code at checkout.
  exports: [PromoService],
})
export class PromoModule {}
