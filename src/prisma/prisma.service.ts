import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { RequestContext } from '../common/logging/request-context';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly logEachQuery =
    (process.env.REQUEST_QUERY_LOG ?? 'true').toLowerCase() !== 'false';

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set. Please define it in your environment (.env).');
    }

    const pool = new PrismaPg({ connectionString: databaseUrl });
    super({
      adapter: pool,
      log: [{ emit: 'event', level: 'query' }],
    });

    this.$on('query', (event: Prisma.QueryEvent) => {
      RequestContext.recordDbQuery(event.duration, event.query);

      if (!this.logEachQuery) {
        return;
      }

      const store = RequestContext.getStore();
      this.logger.debug(
        `db_query request_id=${store?.requestId ?? 'n/a'} duration_ms=${event.duration} query=${event.query.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
      );
    });
  }

  async onModuleInit() {
    const startedAt = Date.now();
    await this.$connect();
    // Touch the pool so the first request does not pay connection setup cost.
    await this.$queryRaw`SELECT 1`;
    this.logger.log(
      `Prisma connected and warmed durationMs=${Date.now() - startedAt}`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
