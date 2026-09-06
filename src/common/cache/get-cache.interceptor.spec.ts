import { of } from 'rxjs';
import { GetCacheInterceptor } from './get-cache.interceptor';
import { GetResponseCache } from './get-response.cache';

function mockHttp(
  method: string,
  url: string,
  query: Record<string, unknown> = {},
) {
  const headers: Record<string, string> = {};
  const response = {
    statusCode: 200,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  };
  const request = {
    method,
    originalUrl: url,
    url,
    query,
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
  return { context, headers };
}

describe('GetCacheInterceptor', () => {
  const cache = {
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    invalidateShared: jest.fn(),
  };

  let interceptor: GetCacheInterceptor;
  const prevEnabled = process.env.GET_CACHE_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GET_CACHE_ENABLED = 'true';
    interceptor = new GetCacheInterceptor(cache as unknown as GetResponseCache);
  });

  afterAll(() => {
    process.env.GET_CACHE_ENABLED = prevEnabled;
  });

  async function run(method: string, url: string, query?: Record<string, unknown>) {
    const { context, headers } = mockHttp(method, url, query);
    const next = { handle: () => of({ ok: true }) };
    await new Promise<void>((resolve) => {
      interceptor.intercept(context as never, next as never).subscribe({
        complete: () => resolve(),
      });
    });
    return headers;
  }

  it('caches quiz catalog and course list', async () => {
    expect((await run('GET', '/quiz'))['X-Cache']).toBe('MISS');
    expect(cache.get).toHaveBeenCalledWith('shared:/quiz');
    expect(cache.set).toHaveBeenCalled();

    jest.clearAllMocks();
    expect((await run('GET', '/course'))['X-Cache']).toBe('MISS');
    expect(cache.get).toHaveBeenCalledWith('shared:/course');
  });

  it('does not cache topic, course detail, or per-user paths', async () => {
    for (const url of [
      '/topic',
      '/topic/abc',
      '/course/c1',
      '/course/slug/js',
      '/course/c1/topics',
      '/course/progress/me',
      '/attempt/me',
      '/auth/me',
      '/certificate/me',
    ]) {
      jest.clearAllMocks();
      const headers = await run('GET', url);
      expect(headers['X-Cache']).toBeUndefined();
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    }
  });

  it('bypasses with ?nocache=1', async () => {
    const headers = await run('GET', '/quiz?nocache=1', { nocache: '1' });
    expect(headers['X-Cache']).toBe('BYPASS');
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('invalidates shared catalog on topic/quiz/course writes only', async () => {
    await run('PUT', '/topic/abc');
    expect(cache.invalidateShared).toHaveBeenCalled();

    jest.clearAllMocks();
    await run('POST', '/attempt/session/s1/save');
    expect(cache.invalidateShared).not.toHaveBeenCalled();
  });
});
