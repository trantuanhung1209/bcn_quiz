import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger } from 'winston';
import { RequestContext } from './request-context';

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

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logQueries =
    (process.env.REQUEST_QUERY_LOG ?? 'true').toLowerCase() !== 'false';

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,
  ) {}

  use(
    request: Request & { user?: RequestUser },
    response: Response,
    next: NextFunction,
  ): void {
    const store = RequestContext.createStore();
    const method = request.method;
    const url = request.originalUrl ?? request.url;

    RequestContext.run(store, () => {
      this.logger.log('info', 'request_received', {
        request_id: store.requestId,
        action: `${method} ${url}`,
        method,
        url,
        ip: this.extractClientIp(request),
      });

      response.on('finish', () => {
        const finishedAt = Date.now();
        const durationMs = finishedAt - store.startedAt;
        const lastDbToResponseMs =
          store.lastDbEndedAt == null
            ? null
            : Math.max(0, finishedAt - store.lastDbEndedAt);
        const nonDbDurationMs = Math.max(0, durationMs - store.dbDurationMs);
        const status = response.statusCode;
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

        this.logger.log(level, 'request_completed', {
          request_id: store.requestId,
          user_id: this.extractUserId(request.user),
          action: `${method} ${url}`,
          method,
          url,
          status,
          statusCode: status,
          ip: this.extractClientIp(request),
          duration_ms: durationMs,
          db_duration_ms: store.dbDurationMs,
          db_query_count: store.dbQueryCount,
          non_db_duration_ms: nonDbDurationMs,
          last_db_to_response_ms: lastDbToResponseMs,
          ...(this.logQueries && store.queries.length > 0
            ? { db_queries: store.queries }
            : {}),
        });
      });

      next();
    });
  }

  private extractClientIp(request: Request): string | undefined {
    const forwardedFor = request.headers['x-forwarded-for'];

    if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) {
      return forwardedFor.split(',')[0].trim();
    }

    if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
      return forwardedFor[0];
    }

    return request.ip || request.socket.remoteAddress;
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
