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
});
