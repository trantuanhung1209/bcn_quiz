import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set. Please define it in your environment (.env).');
    }

    const pool = new PrismaPg({ connectionString: databaseUrl });
    super({ adapter: pool });
  }
  async onModuleInit() {
    // Note: this is optional
    await this.$connect();
  }
}