import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/**
 * Shared catalog GET response cache backed by Redis.
 * Relative keys are stored under REDIS_KEY_PREFIX (bcn:quiz:).
 */
@Injectable()
export class GetResponseCache {
  private readonly ttlMs: number;

  constructor(private readonly redis: RedisService) {
    const raw = Number(process.env.GET_CACHE_TTL_MS ?? 20_000);
    this.ttlMs = Number.isFinite(raw) && raw > 0 ? raw : 20_000;
  }

  private cacheKey(key: string): string {
    return `get:${key}`;
  }

  async get(key: string): Promise<unknown> {
    if (this.ttlMs <= 0) {
      return undefined;
    }
    return this.redis.getJson(this.cacheKey(key));
  }

  async set(key: string, value: unknown): Promise<void> {
    if (this.ttlMs <= 0) {
      return;
    }
    await this.redis.setJson(this.cacheKey(key), value, this.ttlMs);
  }

  /** Drop every shared catalog entry. */
  async invalidateShared(): Promise<number> {
    return this.redis.delByPrefix('get:shared:');
  }

  async clear(): Promise<number> {
    return this.redis.delByPrefix('get:');
  }
}
