import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { MlmModule } from '../mlm/mlm.module';
import { PromoModule } from '../promo/promo.module';

@Module({
  imports: [MlmModule, PromoModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
