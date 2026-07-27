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

// Metrics page accessible ONLY via a secret link: /metrics/:token
// (token = METRICS_TOKEN environment variable). No session required.
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
      // Generic 403: doesn't indicate whether the token is missing or wrong.
      throw new ForbiddenException();
    }

    // DB probe + a few business metrics.
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

    // Resilient: if the status tables don't exist yet (schema not applied in
    // prod), degrade gracefully instead of failing the whole page.
    let status: Awaited<ReturnType<StatusService['getStatus']>> | {
      services: never[];
      incidents: never[];
    } = { services: [], incidents: [] };
    try {
      status = await this.status.getStatus();
    } catch {
      /* status tables missing: empty section */
    }
    return { database, counts, ...this.metrics.snapshot(), ...status };
  }
}

// Constant-time comparison to avoid timing attacks.
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
