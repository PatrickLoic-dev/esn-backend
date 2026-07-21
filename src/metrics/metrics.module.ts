import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { StatusService } from './status.service';

// Global : MetricsService est injecté par l'intercepteur enregistré dans main.
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, StatusService],
  exports: [MetricsService],
})
export class MetricsModule {}
