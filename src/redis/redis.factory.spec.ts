import { ConfigService } from '@nestjs/config';
import { resolveRedisMode } from './redis.factory';

describe('resolveRedisMode', () => {
  it('uses sentinel when sentinels + name are set', () => {
    const config = {
      get: (key: string) => {
        if (key === 'REDIS_SENTINELS') return '127.0.0.1:26379';
        if (key === 'REDIS_SENTINEL_NAME') return 'mymaster';
        return undefined;
      },
    } as ConfigService;

    expect(resolveRedisMode(config)).toBe('sentinel');
  });

  it('defaults to standalone', () => {
    const config = {
      get: () => undefined,
    } as unknown as ConfigService;

    expect(resolveRedisMode(config)).toBe('standalone');
  });
});
