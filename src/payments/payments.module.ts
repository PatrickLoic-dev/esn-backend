import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { NotchPayClient } from './notchpay.client';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, NotchPayClient],
})
export class PaymentsModule {}
