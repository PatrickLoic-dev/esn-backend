import { Module } from '@nestjs/common';
import { MlmController } from './mlm.controller';
import { MlmService } from './mlm.service';

@Module({
  controllers: [MlmController],
  providers: [MlmService],
  // Exported so Auth (referral linking at sign-up) and Orders (awarding
  // points on purchase) can reuse the service.
  exports: [MlmService],
})
export class MlmModule {}
