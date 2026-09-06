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

/** Mutating these prefixes invalidates shared catalog cache. */
const WRITE_INVALIDATE_PREFIXES = ['/quiz', '/topic', '/course'];

/** Writes that only affect the caller (session, attempts, own progress). */
function isPersonalWrite(path: string): boolean {
  return (
    path.startsWith('/attempt') ||
    path.startsWith('/progress') ||
    path.includes('/session') ||
    path.includes('/attempt')
  );
}

function isCatalogWrite(path: string): boolean {
  if (isPersonalWrite(path)) {
    return false;
  }

  if (
    path.includes('/project-submission') ||
    path.includes('/progress')
  ) {
    return false;
  }

  return WRITE_INVALIDATE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function isCrossUserWrite(path: string): boolean {
  return (
    isCatalogWrite(path) ||
    path.includes('/project-submission') ||
    path.includes('/review')
  );
}

@Injectable()
export class GetCacheInterceptor implements NestInterceptor {
  private readonly browserMaxAgeSec = Math.max(
    0,
    Math.floor(Number(process.env.GET_CACHE_BROWSER_MAX_AGE_SEC ?? 0)),
  );

  private readonly enabled =
    (process.env.GET_CACHE_ENABLED ?? 'true').toLowerCase() !== 'false';

  constructor(private readonly cache: GetResponseCache) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: RequestUser }>();
    const response = http.getResponse<Response>();

    const url = request.originalUrl ?? request.url ?? '';
    const pathOnly = url.split('?')[0] ?? url;

    // Writes: drop shared catalog and/or per-user progress after mutations.
    if (request.method !== 'GET') {
      const invalidateShared = isCatalogWrite(pathOnly);
      const invalidateAllUsers = isCrossUserWrite(pathOnly);
      const invalidateCurrentUser = isPersonalWrite(pathOnly);

      if (!invalidateShared && !invalidateAllUsers && !invalidateCurrentUser) {
        return next.handle();
      }

      return next.handle().pipe(
        tap({
          next: () => {
            const status = response.statusCode || 200;
            if (status >= 200 && status < 400) {
              if (invalidateShared) {
                this.cache.invalidateShared();
              }
              if (invalidateAllUsers) {
                this.cache.invalidateAllUsers();
              } else if (invalidateCurrentUser) {
                const userId = this.extractUserId(request.user);
                if (userId) {
                  this.cache.invalidateUser(userId);
                }
              }
            }
          },
        }),
      );
    }

    if (this.shouldBypass(url, pathOnly, request.query as Record<string, unknown>)) {
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

    // Stale entries must be refetched — serving them without a refresh
    // left progress/attempt responses wrong until the hard TTL elapsed.
    if (lookup.hit === 'fresh') {
      this.setCacheHeaders(response, 'HIT', scope);
      return of(lookup.value);
    }

    this.setCacheHeaders(response, 'MISS', scope);
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
    state: 'HIT' | 'MISS' | 'BYPASS',
    scope: 'shared' | 'user' = 'shared',
  ): void {
    response.setHeader('X-Cache', state);
    // Shared catalog (admin quiz/topic lists) must not be browser-cached —
    // otherwise CRUD looks "stuck" for max-age seconds even after server invalidate.
    if (scope === 'shared' || this.browserMaxAgeSec <= 0) {
      response.setHeader('Cache-Control', 'private, no-cache');
      response.setHeader('Vary', 'Authorization, Cookie');
      return;
    }

    if (state !== 'BYPASS') {
      response.setHeader(
        'Cache-Control',
        `private, max-age=${this.browserMaxAgeSec}, stale-while-revalidate=${Math.max(this.browserMaxAgeSec, 60)}`,
      );
      response.setHeader('Vary', 'Authorization, Cookie');
    }
  }

  private shouldBypass(
    url: string,
    pathOnly: string,
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
    if (pathOnly === '/') {
      return true;
    }
    // Admin quiz editor: always fresh after import/delete (avoid stale "full" lists).
    if (pathOnly.includes('/quizzes/full') || pathOnly.endsWith('/quizzes')) {
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
