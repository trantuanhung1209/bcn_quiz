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

/** Paths whose payload is identical for every authenticated user. */
const SHARED_GET_PREFIXES = ['/quiz', '/topic', '/course'];

/**
 * Per-user / mutable learner data — never response-cache these.
 * Stale progress/attempt/certificate after submit felt like "wait minutes".
 */
const NO_CACHE_GET_PATH_MARKERS = [
  '/auth/me',
  '/progress/me',
  '/project-submission',
  '/certificate/me',
  '/attempt/',
];

/** Mutating these prefixes clears the in-memory GET cache. */
const WRITE_INVALIDATE_PREFIXES = [
  '/quiz',
  '/topic',
  '/course',
  '/attempt',
  '/progress',
  '/certificate',
];

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
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const url = request.originalUrl ?? request.url ?? '';
    const pathOnly = url.split('?')[0] ?? url;

    // Writes: after success, drop ALL GET cache so admin/list refresh immediately.
    if (request.method !== 'GET') {
      if (!this.shouldInvalidateOnWrite(pathOnly)) {
        return next.handle();
      }

      return next.handle().pipe(
        tap({
          next: () => {
            const status = response.statusCode || 200;
            if (status >= 200 && status < 400) {
              this.cache.clear();
            }
          },
        }),
      );
    }

    if (this.shouldBypass(pathOnly, request.query as Record<string, unknown>)) {
      response.setHeader('X-Cache', 'BYPASS');
      return next.handle();
    }

    const scope = this.resolveScope(pathOnly);
    if (!scope) {
      return next.handle();
    }

    const cacheKey = `shared:shared:${url}`;
    const lookup = this.cache.lookup(cacheKey);

    // Only serve fresh. Soft-stale must re-fetch so CRUD never looks "stuck".
    if (lookup.hit === 'fresh') {
      this.setCacheHeaders(response, 'HIT');
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

  private shouldInvalidateOnWrite(path: string): boolean {
    return WRITE_INVALIDATE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
  }

  private setCacheHeaders(
    response: Response,
    state: 'HIT' | 'MISS' | 'BYPASS',
  ): void {
    response.setHeader('X-Cache', state);
    // Shared catalog must not be browser-cached — otherwise CRUD looks stuck.
    if (this.browserMaxAgeSec <= 0) {
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
    // Admin quiz editor: always fresh after import/delete.
    if (pathOnly.includes('/quizzes/full') || pathOnly.endsWith('/quizzes')) {
      return true;
    }
    // Learner / me endpoints: always fresh.
    if (this.isNoCacheGetPath(pathOnly)) {
      return true;
    }
    return false;
  }

  private isNoCacheGetPath(path: string): boolean {
    if (path === '/auth/me' || path.startsWith('/auth/me/')) {
      return true;
    }
    if (path.startsWith('/attempt/') || path === '/attempt') {
      return true;
    }
    if (path.includes('/progress/me') || path.startsWith('/progress/me')) {
      return true;
    }
    if (path.includes('/project-submission')) {
      return true;
    }
    if (path === '/certificate/me' || path.startsWith('/certificate/me')) {
      return true;
    }
    return NO_CACHE_GET_PATH_MARKERS.some(
      (marker) => path === marker || path.includes(marker),
    );
  }

  /** Only shared catalog GETs are cached now. */
  private resolveScope(path: string): 'shared' | null {
    if (this.isNoCacheGetPath(path)) {
      return null;
    }

    for (const prefix of SHARED_GET_PREFIXES) {
      if (
        path === prefix ||
        path.startsWith(`${prefix}?`) ||
        path.startsWith(`${prefix}/`)
      ) {
        return 'shared';
      }
    }

    return null;
  }
}
