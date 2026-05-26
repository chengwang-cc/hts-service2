import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wrap raw controller return values as `{success: true, data: ...}` to
 * match the project's response convention used by existing
 * admin/knowledge/users/roles controllers. Apply with `@UseInterceptors`
 * at the controller class level — see e.g. BrokerOutreachAdminController.
 *
 * If a handler already returns `{success: ..., data: ...}` (the explicit
 * pattern used by some legacy controllers) we leave it alone.
 */
@Injectable()
export class WrapResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          'success' in (value as Record<string, unknown>)
        ) {
          return value;
        }
        return { success: true, data: value };
      }),
    );
  }
}
