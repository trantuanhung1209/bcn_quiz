import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { GetResponseCache } from './get-response.cache';

type RequestUser = {
  id?: unknown;
  userId?: unknown;
  sub?: unknown;
  data?: {
    id?: unknown;
    user?: {
      id?: unknown;
      userId?: unknown;
      sub?: unknown;
    };
  };
};

/** Paths whose payload is identical for every authenticated user. */
const SHARED_GET_PREFIXES = ['/quiz', '/topic', '/course'];

/** Paths that must be cached per user. */
const PER_USER_GET_PREFIXES = [
  '/auth/me',
  '/course/progress/me',
  '/attempt/',
  '/progress/me',
  '/certificate/me',
];

@Injectable()
export class GetCacheInterceptor implements NestInterceptor {
  private readonly ttlMs = Number(process.env.GET_CACHE_TTL_MS ?? 60_000);
  private readonly staleMs = Number(
    process.env.GET_CACHE_STALE_MS ?? Math.max(this.ttlMs, 60_000),
  );
  private readonly browserMaxAgeSec = Math.max(
    0,
    Math.floor(Number(process.env.GET_CACHE_BROWSER_MAX_AGE_SEC ?? 30)),
  );

  private readonly cache = new GetResponseCache(
    this.ttlMs,
    Number(process.env.GET_CACHE_MAX_ENTRIES ?? 500),
    this.staleMs,
  );

  private readonly enabled =
    (process.env.GET_CACHE_ENABLED ?? 'true').toLowerCase() !== 'false';

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: RequestUser }>();
    const response = http.getResponse<Response>();

    if (request.method !== 'GET') {
      return next.handle();
    }

    const url = request.originalUrl ?? request.url ?? '';
    const pathOnly = url.split('?')[0] ?? url;

    if (this.shouldBypass(url, request.query as Record<string, unknown>)) {
      response.setHeader('X-Cache', 'BYPASS');
      return next.handle();
    }

    const scope = this.resolveScope(pathOnly);
    if (!scope) {
      return next.handle();
    }

    const userId =
      scope === 'user' ? this.extractUserId(request.user) : 'shared';
    if (scope === 'user' && !userId) {
      return next.handle();
    }

    const cacheKey = `${scope}:${userId}:${url}`;
    const lookup = this.cache.lookup(cacheKey);

    // Fresh or soft-stale: both short-circuit DB. Soft-stale extends HIT rate
    // without re-entering next.handle() on the same response (unsafe).
    if (lookup.hit === 'fresh' || lookup.hit === 'stale') {
      this.setCacheHeaders(response, lookup.hit === 'fresh' ? 'HIT' : 'STALE');
      return of(lookup.value);
    }

    this.setCacheHeaders(response, 'MISS');
    return next.handle().pipe(
      tap((body) => {
        const status = response.statusCode || 200;
        if (status >= 200 && status < 300) {
          this.cache.set(cacheKey, body);
        }
      }),
    );
  }

  private setCacheHeaders(
    response: Response,
    state: 'HIT' | 'STALE' | 'MISS' | 'BYPASS',
  ): void {
    response.setHeader('X-Cache', state);
    // private: authenticated payloads must not be shared by intermediate CDNs.
    // Browser can reuse briefly → clientTotal often << 500ms on repeats.
    if (this.browserMaxAgeSec > 0 && state !== 'BYPASS') {
      response.setHeader(
        'Cache-Control',
        `private, max-age=${this.browserMaxAgeSec}, stale-while-revalidate=${Math.max(this.browserMaxAgeSec, 60)}`,
      );
      response.setHeader('Vary', 'Authorization, Cookie');
    }
  }

  private shouldBypass(
    url: string,
    query: Record<string, unknown>,
  ): boolean {
    const nocache = query?.nocache;
    const revalidate = query?.revalidate;
    if (nocache === '1' || nocache === 'true' || nocache === true) {
      return true;
    }
    if (revalidate === '1' || revalidate === 'true' || revalidate === true) {
      return true;
    }
    if ((url.split('?')[0] ?? '') === '/') {
      return true;
    }
    return false;
  }

  private resolveScope(path: string): 'shared' | 'user' | null {
    if (path === '/auth/me') {
      return 'user';
    }

    if (
      path.startsWith('/course/progress/me') ||
      path.includes('/progress/me') ||
      path.includes('/project-submission')
    ) {
      return 'user';
    }

    for (const prefix of PER_USER_GET_PREFIXES) {
      if (path === prefix || path.startsWith(prefix)) {
        return 'user';
      }
    }

    for (const prefix of SHARED_GET_PREFIXES) {
      if (
        path === prefix ||
        path.startsWith(`${prefix}?`) ||
        path.startsWith(`${prefix}/`)
      ) {
        if (prefix === '/course' && path.includes('/progress/')) {
          return 'user';
        }
        return 'shared';
      }
    }

    return null;
  }

  private extractUserId(user?: RequestUser): string | undefined {
    const candidates = [
      user?.id,
      user?.userId,
      user?.sub,
      user?.data?.id,
      user?.data?.user?.id,
      user?.data?.user?.userId,
      user?.data?.user?.sub,
    ];

    const userId = candidates.find(
      (value): value is string | number =>
        (typeof value === 'string' && value.trim().length > 0) ||
        typeof value === 'number',
    );

    return userId === undefined ? undefined : String(userId);
  }
}
