import { Injectable } from '@nestjs/common';

// Compteurs d'observabilité en mémoire (process courant). Léger, sans
// dépendance externe : suffisant pour une page de suivi interne.
@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private requests = 0;
  private errors = 0;
  private totalMs = 0;
  private readonly byStatus: Record<string, number> = {};
  private readonly byRoute: Record<string, { count: number; ms: number }> = {};

  record(route: string, statusCode: number, durationMs: number) {
    this.requests += 1;
    this.totalMs += durationMs;
    if (statusCode >= 500) this.errors += 1;
    const bucket = `${Math.floor(statusCode / 100)}xx`;
    this.byStatus[bucket] = (this.byStatus[bucket] ?? 0) + 1;
    const r = (this.byRoute[route] ??= { count: 0, ms: 0 });
    r.count += 1;
    r.ms += durationMs;
  }

  snapshot() {
    const mem = process.memoryUsage();
    const topRoutes = Object.entries(this.byRoute)
      .map(([route, v]) => ({
        route,
        count: v.count,
        avgMs: Math.round(v.ms / v.count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      requests: this.requests,
      errors: this.errors,
      errorRate: this.requests ? this.errors / this.requests : 0,
      avgResponseMs: this.requests ? Math.round(this.totalMs / this.requests) : 0,
      byStatus: this.byStatus,
      topRoutes,
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      },
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    };
  }
}
