import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/**
 * Simple in-memory rate limiter for the public /auth/register endpoint.
 * Protects against bulk-registration abuse and email enumeration.
 *
 * Limits:
 *   - 5 registrations per IP per 10 minutes
 *   - 20 registrations per IP per hour (catches slow drips)
 */
@Injectable()
export class RegisterRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RegisterRateLimitGuard.name);
  private readonly short = new Map<string, number[]>();
  private readonly long = new Map<string, number[]>();

  private readonly SHORT_WINDOW_MS = 10 * 60 * 1000;
  private readonly SHORT_LIMIT = 5;
  private readonly LONG_WINDOW_MS = 60 * 60 * 1000;
  private readonly LONG_LIMIT = 20;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const ip = this.extractIp(request);
    const now = Date.now();

    if (this.exceedsLimit(this.short, ip, this.SHORT_WINDOW_MS, this.SHORT_LIMIT, now)) {
      this.logger.warn(`Register rate limit exceeded (short window) for IP: ${ip}`);
      throw new HttpException(
        'Too many registration attempts. Please try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (this.exceedsLimit(this.long, ip, this.LONG_WINDOW_MS, this.LONG_LIMIT, now)) {
      this.logger.warn(`Register rate limit exceeded (long window) for IP: ${ip}`);
      throw new HttpException(
        'Registration limit exceeded for this hour. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.record(this.short, ip, now);
    this.record(this.long, ip, now);
    return true;
  }

  private exceedsLimit(
    bucket: Map<string, number[]>,
    key: string,
    windowMs: number,
    limit: number,
    now: number,
  ): boolean {
    const cutoff = now - windowMs;
    const entries = (bucket.get(key) ?? []).filter((t) => t > cutoff);
    bucket.set(key, entries);
    return entries.length >= limit;
  }

  private record(bucket: Map<string, number[]>, key: string, now: number): void {
    const entries = bucket.get(key) ?? [];
    entries.push(now);
    bucket.set(key, entries);
  }

  private extractIp(request: any): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return (
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      'unknown'
    );
  }
}
