import {
  Controller,
  ForbiddenException,
  Get,
  Param,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';
import { StatusService } from './status.service';

// Page de métriques accessible UNIQUEMENT via un lien secret : /metrics/:token
// (token = variable d'environnement METRICS_TOKEN). Pas de session requise.
@Controller('metrics')
export class MetricsController {
  constructor(
    private metrics: MetricsService,
    private prisma: PrismaService,
    private config: ConfigService,
    private status: StatusService,
  ) {}

  @Public()
  @Get(':token')
  async snapshot(@Param('token') token: string) {
    const expected = this.config.get<string>('METRICS_TOKEN') ?? '';
    if (!expected || !safeEqual(token, expected)) {
      // 403 générique : n'indique pas si le token est absent ou faux.
      throw new ForbiddenException();
    }

    // Sonde DB + quelques métriques métier.
    let database = 'up';
    let counts = { users: 0, orders: 0, products: 0, tickets: 0 };
    try {
      const [users, orders, products, tickets] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.order.count(),
        this.prisma.product.count(),
        this.prisma.ticket.count(),
      ]);
      counts = { users, orders, products, tickets };
    } catch {
      database = 'down';
    }

    // Résilient : si les tables de statut n'existent pas encore (schéma non
    // appliqué en prod), on dégrade sans faire échouer toute la page.
    let status: Awaited<ReturnType<StatusService['getStatus']>> | {
      services: never[];
      incidents: never[];
    } = { services: [], incidents: [] };
    try {
      status = await this.status.getStatus();
    } catch {
      /* tables de statut absentes : section vide */
    }
    return { database, counts, ...this.metrics.snapshot(), ...status };
  }
}

// Comparaison à temps constant pour éviter les attaques temporelles.
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
