import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Sondes de santé pour l'orchestrateur (Docker / Kubernetes).
 * - `/api/health`       : liveness — le process répond, sans toucher la base.
 * - `/api/health/ready` : readiness — vérifie que la base est joignable.
 * Les deux routes sont publiques (pas de JWT) pour être appelées par le
 * HEALTHCHECK du conteneur et le load balancer.
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
      // Requête minimale : confirme que la connexion Postgres est établie.
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'up' };
    } catch {
      // 503 : l'instance ne doit pas recevoir de trafic tant que la base
      // n'est pas joignable.
      throw new ServiceUnavailableException({
        status: 'not-ready',
        database: 'down',
      });
    }
  }
}
