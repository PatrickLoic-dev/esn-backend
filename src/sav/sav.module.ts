import { Module } from '@nestjs/common';
import { SavService } from './sav.service';
import { SavController } from './sav.controller';
import { SavGateway } from './sav.gateway';

@Module({
  controllers: [SavController],
  providers: [SavService, SavGateway],
})
export class SavModule {}
