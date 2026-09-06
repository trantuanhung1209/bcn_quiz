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

/** Catalog prefixes whose mutations invalidate the shared GET cache. */
const WRITE_INVALIDATE_PREFIXES = ['/quiz', '/topic', '/course'];

/**
 * Only these GETs are response-cached (stable shared catalog).
 * Topics, course detail/topics, progress, attempts, auth/me are never cached here.
 */
function isSharedCacheableGet(path: string): boolean {
  if (path === '/quiz' || path.startsWith('/quiz/')) {
    return true;
  }
  if (path === '/course') {
    return true;
  }
  if (/^\/course\/[^/]+\/project-requirement$/.test(path)) {
    return true;
  }
  return false;
}

function isPersonalWrite(path: string): boolean {
  return (
    path.startsWith('/attempt') ||
    path.startsWith('/progress') ||
    path.includes('/session') ||
    path.includes('/attempt') ||
    path.includes('/project-submission') ||
    path.includes('/progress')
  );
}

function isCatalogWrite(path: string): boolean {
  if (isPersonalWrite(path)) {
    return false;
  }

  return WRITE_INVALIDATE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

@Injectable()
export class GetCacheInterceptor implements NestInterceptor {
  private readonly enabled =
    (process.env.GET_CACHE_ENABLED ?? 'true').toLowerCase() !== 'false';

  constructor(private readonly cache: GetResponseCache) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const url = request.originalUrl ?? request.url ?? '';
    const pathOnly = url.split('?')[0] ?? url;

    if (request.method !== 'GET') {
      if (!isCatalogWrite(pathOnly)) {
        return next.handle();
      }

      return next.handle().pipe(
        tap({
          next: () => {
            const status = response.statusCode || 200;
            if (status >= 200 && status < 400) {
              this.cache.invalidateShared();
            }
          },
        }),
      );
    }

    if (this.shouldBypass(pathOnly, request.query as Record<string, unknown>)) {
      response.setHeader('X-Cache', 'BYPASS');
      response.setHeader('Cache-Control', 'private, no-cache');
      return next.handle();
    }

    if (!isSharedCacheableGet(pathOnly)) {
      return next.handle();
    }

    const cacheKey = `shared:${url}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      this.setCacheHeaders(response, 'HIT');
      return of(cached);
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

  private setCacheHeaders(response: Response, state: 'HIT' | 'MISS'): void {
    response.setHeader('X-Cache', state);
    response.setHeader('Cache-Control', 'private, no-cache');
    response.setHeader('Vary', 'Authorization, Cookie');
  }

  private shouldBypass(
    pathOnly: string,
    query: Record<string, unknown>,
  ): boolean {
    const nocache = query?.nocache;
    if (nocache === '1' || nocache === 'true' || nocache === true) {
      return true;
    }
    return false;
  }
}
