import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Kept for DI compatibility. Request timing/DB breakdown is handled by
 * {@link RequestLoggingMiddleware} so auth/guards are included in duration.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle();
  }
}
