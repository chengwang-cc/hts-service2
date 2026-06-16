import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of, switchMap, tap, catchError, throwError } from 'rxjs';
import type { Request, Response } from 'express';
import { IdempotencyService } from '../services/idempotency.service';
import { IDEMPOTENT_SCOPE_KEY } from '../decorators/idempotent.decorator';

/**
 * Reads `Idempotency-Key` from the incoming request and:
 *
 *   1. If the route is NOT marked `@Idempotent(scope)` — pass through.
 *   2. If the header is missing — pass through. The header is opt-in.
 *   3. Look up (scope, key, requestHash). On a hit, short-circuit and
 *      return the cached response with the original status code.
 *      Subsequent middleware doesn't fire — the controller method is
 *      never invoked.
 *   4. On a miss — let the handler run, then persist the response
 *      under the key in a tap() so the NEXT replay hits the cache.
 *      Errors are NOT cached — a 500 on retry should still hit the
 *      handler. 4xx responses ARE cached because they're deterministic
 *      from the request body (validation failures, conflicts, etc.).
 *
 * Streaming responses (e.g. CSV downloads) are NOT supported — the
 * interceptor only handles JSON-serialised payloads where Nest is
 * returning a value from the handler.
 *
 * Org scoping: when the request carries a JWT (`req.user`), the
 * persisted row records the organizationId. NULL for guest/public
 * endpoints. The org id is not part of the lookup key — clients reusing
 * a key across orgs would otherwise observe a 409, which is confusing.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly service: IdempotencyService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const scope = this.reflector.getAllAndOverride<string | undefined>(
      IDEMPOTENT_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!scope) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: { organizationId?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();

    const key = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as
      | string
      | undefined;
    if (!key) return next.handle();

    const requestHash = this.service.hashRequest(
      req.method,
      req.path,
      (req as any).body ?? {},
    );

    return from(
      this.service.lookup({ scope, key, requestHash }),
    ).pipe(
      switchMap((hit) => {
        if (hit) {
          res.status(hit.statusCode);
          return of(hit.body);
        }
        return next.handle().pipe(
          tap((body) => {
            const statusCode = res.statusCode || 200;
            void this.service.save({
              scope,
              key,
              requestHash,
              organizationId: req.user?.organizationId ?? null,
              statusCode,
              body,
            });
          }),
          catchError((err: HttpException | Error) => {
            // Cache 4xx but not 5xx / non-HttpExceptions. A 5xx is
            // assumed transient; the client SHOULD be able to retry
            // with the same key and get a fresh attempt.
            if (err instanceof HttpException) {
              const statusCode = err.getStatus();
              if (statusCode >= 400 && statusCode < 500) {
                void this.service.save({
                  scope,
                  key,
                  requestHash,
                  organizationId: req.user?.organizationId ?? null,
                  statusCode,
                  body: err.getResponse(),
                });
              }
            }
            return throwError(() => err);
          }),
        );
      }),
    );
  }
}
