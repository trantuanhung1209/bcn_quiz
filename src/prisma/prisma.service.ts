import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set. Please define it in your environment (.env).');
    }

    const pool = new PrismaPg({ connectionString: databaseUrl });
    super({ adapter: pool });
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