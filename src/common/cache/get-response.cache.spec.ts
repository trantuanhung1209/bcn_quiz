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

  it('drops entries after TTL', () => {
    jest.useFakeTimers();
    const cache = new GetResponseCache(1_000, 10);

    cache.set('k', { ok: true });
    expect(cache.get('k')).toEqual({ ok: true });

    jest.advanceTimersByTime(1_001);
    expect(cache.get('k')).toBeUndefined();

    jest.useRealTimers();
  });

  it('invalidateShared drops only shared:* keys', () => {
    const cache = new GetResponseCache(60_000, 10);
    cache.set('shared:/quiz', { items: [1] });
    cache.set('shared:/course', { items: [] });
    cache.set('other:key', { keep: true });

    expect(cache.invalidateShared()).toBe(2);
    expect(cache.get('shared:/quiz')).toBeUndefined();
    expect(cache.get('other:key')).toEqual({ keep: true });
    expect(cache.size).toBe(1);
  });
});
