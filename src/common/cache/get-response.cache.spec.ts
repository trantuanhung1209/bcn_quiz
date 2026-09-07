import { GetResponseCache } from './get-response.cache';
import type { RedisService } from '../../redis/redis.service';

function createRedisMock() {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      getJson: jest.fn(async (key: string) => {
        const raw = store.get(key);
        return raw == null ? undefined : JSON.parse(raw);
      }),
      setJson: jest.fn(async (key: string, value: unknown) => {
        store.set(key, JSON.stringify(value));
      }),
      delByPrefix: jest.fn(async (prefix: string) => {
        let n = 0;
        for (const key of [...store.keys()]) {
          if (key.startsWith(prefix)) {
            store.delete(key);
            n += 1;
          }
        }
        return n;
      }),
    } as unknown as RedisService,
  };
}

describe('GetResponseCache', () => {
  const prevTtl = process.env.GET_CACHE_TTL_MS;

  beforeEach(() => {
    process.env.GET_CACHE_TTL_MS = '60000';
  });

  afterAll(() => {
    process.env.GET_CACHE_TTL_MS = prevTtl;
  });

  it('stores and returns JSON values', async () => {
    const { redis } = createRedisMock();
    const cache = new GetResponseCache(redis);
    await cache.set('shared:/quiz', { items: [1] });
    await expect(cache.get('shared:/quiz')).resolves.toEqual({ items: [1] });
    expect(redis.setJson).toHaveBeenCalledWith(
      'get:shared:/quiz',
      { items: [1] },
      60_000,
    );
  });

  it('invalidateShared drops only shared catalog keys', async () => {
    const { redis, store } = createRedisMock();
    store.set('get:shared:/quiz', JSON.stringify({ items: [1] }));
    store.set('get:shared:/course', JSON.stringify({ items: [] }));
    store.set('get:other:key', JSON.stringify({ keep: true }));

    const cache = new GetResponseCache(redis);
    await expect(cache.invalidateShared()).resolves.toBe(2);
    expect(store.has('get:shared:/quiz')).toBe(false);
    expect(store.has('get:other:key')).toBe(true);
  });
});
