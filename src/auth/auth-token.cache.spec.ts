import { AuthTokenCache } from './auth-token.cache';

describe('AuthTokenCache', () => {
  it('returns cached values within TTL', async () => {
    const cache = new AuthTokenCache<string>(60_000, 10);
    const loader = jest.fn(async () => 'user');

    await expect(cache.getOrLoad('k1', loader)).resolves.toBe('user');
    await expect(cache.getOrLoad('k1', loader)).resolves.toBe('user');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent loads for the same key', async () => {
    const cache = new AuthTokenCache<string>(60_000, 10);
    let resolveLoader!: (value: string) => void;
    const loader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const first = cache.getOrLoad('same', loader);
    const second = cache.getOrLoad('same', loader);

    expect(loader).toHaveBeenCalledTimes(1);
    resolveLoader('ok');

    await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok']);
  });

  it('evicts oldest entries when max size is exceeded', () => {
    const cache = new AuthTokenCache<string>(60_000, 2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });

  it('hashes credentials stably', () => {
    const a = AuthTokenCache.hashCredentials(['Bearer t', 'a=1']);
    const b = AuthTokenCache.hashCredentials(['Bearer t', 'a=1']);
    const c = AuthTokenCache.hashCredentials(['Bearer other', 'a=1']);

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
