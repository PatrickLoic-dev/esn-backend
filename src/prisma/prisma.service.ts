import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Supabase's pooled connection (port 6543) runs PgBouncer in transaction mode.
// Prisma must be told about it (`pgbouncer=true`) or it reuses prepared
// statement names across pooled connections and throws
// "prepared statement \"s0\" already exists". We normalize the URL here
// instead of in the .env so the connection string stays untouched.
function normalizePoolerUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const isPooler = url.includes('pooler.supabase.com:6543');
  if (!isPooler) return url;
  const params: string[] = [];
  if (!url.includes('pgbouncer=true')) params.push('pgbouncer=true');
  // resilience against the pooler dropping idle connections
  if (!url.includes('connection_limit=')) params.push('connection_limit=5');
  if (!url.includes('pool_timeout=')) params.push('pool_timeout=20');
  if (!url.includes('connect_timeout=')) params.push('connect_timeout=15');
  if (params.length === 0) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${params.join('&')}`;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasourceUrl: normalizePoolerUrl(process.env.DATABASE_URL),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
