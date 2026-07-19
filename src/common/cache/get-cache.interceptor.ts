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
  private readonly cache = new GetResponseCache(
    Number(process.env.GET_CACHE_TTL_MS ?? 20_000),
    Number(process.env.GET_CACHE_MAX_ENTRIES ?? 500),
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
    const hit = this.cache.get(cacheKey);
    if (hit !== undefined) {
      response.setHeader('X-Cache', 'HIT');
      return of(hit);
    }

    response.setHeader('X-Cache', 'MISS');
    return next.handle().pipe(
      tap((body) => {
        const status = response.statusCode || 200;
        if (status >= 200 && status < 300) {
          this.cache.set(cacheKey, body);
        }
      }),
    );
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
    // Avoid caching root health spam inconsistently; still cheap.
    if ((url.split('?')[0] ?? '') === '/') {
      return true;
    }
    return false;
  }

  private resolveScope(path: string): 'shared' | 'user' | null {
    if (path === '/auth/me') {
      return 'user';
    }

    // /course/progress/me is user-specific; /course and /course/:id are shared catalog.
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
      if (path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`)) {
        // /course/:id/progress/me already handled above
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
