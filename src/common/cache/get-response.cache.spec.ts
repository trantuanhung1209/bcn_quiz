import { GetResponseCache } from './get-response.cache';

describe('GetResponseCache', () => {
  it('returns values within TTL and evicts oldest', () => {
    const cache = new GetResponseCache(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('serves soft-stale after fresh TTL and drops after hard TTL', () => {
    jest.useFakeTimers();
    const cache = new GetResponseCache(1_000, 10, 2_000);

    cache.set('k', { ok: true });
    expect(cache.lookup('k')).toEqual({ hit: 'fresh', value: { ok: true } });

    jest.advanceTimersByTime(1_001);
    expect(cache.lookup('k')).toEqual({ hit: 'stale', value: { ok: true } });

    jest.advanceTimersByTime(2_000);
    expect(cache.lookup('k')).toEqual({ hit: 'miss' });

    jest.useRealTimers();
  });
});
