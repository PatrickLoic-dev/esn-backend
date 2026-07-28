import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { MlmModule } from '../mlm/mlm.module';

@Module({
  imports: [MlmModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
