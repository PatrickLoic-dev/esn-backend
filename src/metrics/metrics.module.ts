import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { StatusService } from './status.service';

// Global: MetricsService is injected by the interceptor registered in main.
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, StatusService],
  exports: [MetricsService],
})
export class MetricsModule {}
