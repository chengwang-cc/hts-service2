import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';

interface Window {
  windowStartMs: number;
  count: number;
}

/**
 * Simple in-memory per-tenant rate limit on packet uploads. Sized for
 * single-process dev; production should swap in a Redis-backed implementation
 * via the same guard interface. Default: 60 uploads/min/org, configurable via
 * BROKER_PACKET_UPLOAD_RATE_LIMIT (count) and BROKER_PACKET_UPLOAD_RATE_WINDOW_MS.
 */
@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(TenantRateLimitGuard.name);
  private readonly windowMs = Number(
    process.env.BROKER_PACKET_UPLOAD_RATE_WINDOW_MS || 60_000,
  );
  private readonly maxPerWindow = Number(
    process.env.BROKER_PACKET_UPLOAD_RATE_LIMIT || 60,
  );
  private readonly windows = new Map<string, Window>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const ctx = resolveRequestContext(req);
    if (!ctx.organizationId) return true; // let auth guard handle missing tenant

    const now = Date.now();
    const window = this.windows.get(ctx.organizationId);
    if (!window || now - window.windowStartMs >= this.windowMs) {
      this.windows.set(ctx.organizationId, {
        windowStartMs: now,
        count: 1,
      });
      return true;
    }
    window.count += 1;
    if (window.count > this.maxPerWindow) {
      const retryAfterMs = this.windowMs - (now - window.windowStartMs);
      const res = context.switchToHttp().getResponse();
      res?.setHeader?.('retry-after', Math.ceil(retryAfterMs / 1000));
      this.logger.warn(
        `Rate limit exceeded for org ${ctx.organizationId}: ${window.count}/${this.maxPerWindow} in ${this.windowMs}ms`,
      );
      throw new HttpException(
        {
          message: 'Too many packet uploads',
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
