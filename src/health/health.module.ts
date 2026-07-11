import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// PrismaModule est global, la sonde de readiness peut donc injecter PrismaService.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
