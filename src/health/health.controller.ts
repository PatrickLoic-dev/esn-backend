import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Health probes for the orchestrator (Docker / Kubernetes).
 * - `/api/health`       : liveness — the process responds, without touching the database.
 * - `/api/health/ready` : readiness — checks that the database is reachable.
 * Both routes are public (no JWT) so they can be called by the container's
 * HEALTHCHECK and the load balancer.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  liveness() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Public()
  @Get('ready')
  async readiness() {
    try {
      // Minimal query: confirms the Postgres connection is established.
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'up' };
    } catch {
      // 503: the instance must not receive traffic while the database isn't
      // reachable.
      throw new ServiceUnavailableException({
        status: 'not-ready',
        database: 'down',
      });
    }
  }
}
