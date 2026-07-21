import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

type Probe = { up: boolean; error?: string };

// Services suivis sur la page de statut.
const SERVICES = [
  'api',
  'database',
  'mail',
  'storage',
  'payments',
] as const;
type ServiceId = (typeof SERVICES)[number];

const LABELS: Record<ServiceId, string> = {
  api: 'API',
  database: 'Base de données',
  mail: 'Emails (Resend)',
  storage: 'Stockage (S3)',
  payments: 'Paiements (Notch Pay)',
};

const PROBE_INTERVAL_MS = 5 * 60_000; // 5 min
const HEATMAP_DAYS = 90;

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

@Injectable()
export class StatusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatusService.name);
  private timer?: NodeJS.Timeout;
  // Dernier état connu par service (pour l'affichage instantané).
  private readonly current = new Map<ServiceId, Probe>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    void this.probeAll();
    this.timer = setInterval(() => void this.probeAll(), PROBE_INTERVAL_MS);
    // Ne bloque pas l'arrêt du process.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private configured(...keys: string[]): boolean {
    return keys.every((k) => !!this.config.get<string>(k));
  }

  private async probe(service: ServiceId): Promise<Probe> {
    try {
      switch (service) {
        case 'api':
          return { up: true };
        case 'database':
          await this.prisma.$queryRaw`SELECT 1`;
          return { up: true };
        case 'mail':
          return this.configured('RESEND_API_KEY', 'MAIL_FROM')
            ? { up: true }
            : { up: false, error: 'RESEND_API_KEY / MAIL_FROM non configurés' };
        case 'storage':
          return this.configured(
            'S3_ENDPOINT',
            'S3_ACCESS_KEY_ID',
            'S3_SECRET_ACCESS_KEY',
          )
            ? { up: true }
            : { up: false, error: 'Identifiants S3 non configurés' };
        case 'payments':
          return this.configured('NOTCHPAY_PUBLIC_KEY')
            ? { up: true }
            : { up: false, error: 'Clé Notch Pay absente' };
      }
    } catch (err) {
      return { up: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Sonde tous les services, met à jour l'agrégat quotidien et les incidents.
  private async probeAll() {
    const day = today();
    for (const service of SERVICES) {
      const res = await this.probe(service);
      this.current.set(service, res);
      try {
        await this.prisma.serviceDay.upsert({
          where: { service_day: { service, day } },
          create: { service, day, up: res.up ? 1 : 0, total: 1 },
          update: {
            total: { increment: 1 },
            ...(res.up ? { up: { increment: 1 } } : {}),
          },
        });
        await this.reconcileIncident(service, res);
      } catch (err) {
        this.logger.warn(
          `Suivi statut ${service} impossible : ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  // Ouvre un incident quand un service tombe, le résout quand il revient.
  private async reconcileIncident(service: ServiceId, res: Probe) {
    const open = await this.prisma.serviceIncident.findFirst({
      where: { service, resolvedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!res.up && !open) {
      await this.prisma.serviceIncident.create({
        data: { service, error: res.error ?? 'Service indisponible' },
      });
    } else if (res.up && open) {
      await this.prisma.serviceIncident.update({
        where: { id: open.id },
        data: { resolvedAt: new Date() },
      });
    }
  }

  // Données pour la page de statut : services + heatmap + incidents.
  async getStatus() {
    const since = new Date(Date.now() - HEATMAP_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const [days, incidents] = await Promise.all([
      this.prisma.serviceDay.findMany({
        where: { day: { gte: since } },
        orderBy: { day: 'asc' },
      }),
      this.prisma.serviceIncident.findMany({
        orderBy: { startedAt: 'desc' },
        take: 30,
      }),
    ]);

    // Regroupe les jours par service.
    const byService = new Map<string, Map<string, { up: number; total: number }>>();
    for (const d of days) {
      const m = byService.get(d.service) ?? new Map();
      m.set(d.day, { up: d.up, total: d.total });
      byService.set(d.service, m);
    }

    // Grille des 90 derniers jours (jour → ratio ou null si pas de données).
    const range: string[] = [];
    for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
      range.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
    }

    const services = SERVICES.map((service) => {
      const m = byService.get(service);
      const heatmap = range.map((day) => {
        const v = m?.get(day);
        return {
          day,
          ratio: v && v.total ? v.up / v.total : null,
          down: v ? v.total - v.up : 0,
        };
      });
      let up = 0;
      let total = 0;
      m?.forEach((v) => {
        up += v.up;
        total += v.total;
      });
      const cur = this.current.get(service) ?? { up: true };
      return {
        id: service,
        label: LABELS[service],
        status: cur.up ? 'operational' : 'down',
        error: cur.error ?? null,
        uptime: total ? up / total : 1,
        heatmap,
      };
    });

    return {
      services,
      incidents: incidents.map((i) => ({
        id: i.id,
        service: i.service,
        label: LABELS[i.service as ServiceId] ?? i.service,
        error: i.error,
        startedAt: i.startedAt,
        resolvedAt: i.resolvedAt,
        durationMs: (i.resolvedAt ?? new Date()).getTime() - i.startedAt.getTime(),
        ongoing: !i.resolvedAt,
      })),
    };
  }
}
