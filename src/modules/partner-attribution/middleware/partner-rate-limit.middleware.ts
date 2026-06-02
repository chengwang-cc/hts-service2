import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { PartnerRateLimitService } from '../services/partner-rate-limit.service';
import type { RequestAttribution } from '../types';

/**
 * Per-partner rate limiter. Runs after AttributionMiddleware so
 * `req.attribution` is populated.
 *
 * Behavior:
 *   - Internal partners + unknown traffic: skipped (legacy IP limiter still
 *     applies elsewhere).
 *   - When PARTNER_RATE_LIMIT_DRY_RUN=true: never actually 429s, just logs.
 *     Use this for soak-time validation before turning on enforcement.
 *   - When enforcing: 429 + Retry-After + X-RateLimit-Partner-* headers.
 */
@Injectable()
export class PartnerRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PartnerRateLimitMiddleware.name);
  private readonly dryRun =
    (process.env.PARTNER_RATE_LIMIT_DRY_RUN ?? 'true').toLowerCase() === 'true';
  private readonly disabled =
    (process.env.PARTNER_RATE_LIMIT_DISABLED ?? 'false').toLowerCase() === 'true';

  constructor(private readonly limiter: PartnerRateLimitService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (this.disabled) return next();
    const attribution = req.attribution as RequestAttribution | undefined;
    const partnerId = attribution?.partnerId;
    if (!partnerId) return next();
    if (attribution?.attributionSource === 'unknown') return next();
    if (await this.limiter.shouldSkip(partnerId)) return next();

    try {
      const result = await this.limiter.check(partnerId);
      res.setHeader('X-RateLimit-Partner-Limit', result.limit);
      res.setHeader('X-RateLimit-Partner-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Partner-Reset', result.resetAt.toISOString());
      res.setHeader('X-RateLimit-Partner-Granularity', result.granularity);

      if (!result.allowed) {
        if (this.dryRun) {
          this.logger.warn(
            `[dry-run] partner ${partnerId} would have been rate-limited (${result.granularity}, limit=${result.limit})`,
          );
          return next();
        }
        const retryAfterSec = Math.max(
          1,
          Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
        );
        res.setHeader('Retry-After', retryAfterSec);
        res.status(429).json({
          statusCode: 429,
          code: 'PARTNER_RATE_LIMITED',
          message: `Partner rate limit exceeded (${result.granularity}, ${result.limit}). Retry after ${retryAfterSec}s.`,
        });
        return;
      }

      next();
    } catch (err) {
      // Limiter failure must not kill the request — let it through.
      this.logger.error(`Rate limit check failed for partner ${partnerId}: ${(err as Error)?.message}`);
      next();
    }
  }
}
