import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { ApiUsageMetricEntity } from '../../api-keys/entities/api-usage-metric.entity';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { getEffectiveLimits } from '../../billing/types/effective-limits';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  granularity: 'minute' | 'day';
}

/**
 * Per-partner rate limit overrides live on `organizations.settings.effectiveLimits`
 * (preferred — synced from the active subscription plan) or `settings.rateLimits`
 * (legacy). Both shapes are read by getEffectiveLimits().
 */
export interface PartnerRateLimits {
  perMinute: number;
  perDay: number;
}

const DEFAULT_LIMITS: PartnerRateLimits = {
  perMinute: 600,
  perDay: 50_000,
};

/**
 * Per-partner counters live in api_usage_metrics; we COUNT rows in the
 * sliding window. Same approach the legacy api_keys rate limiter uses, so
 * we don't pull in Redis or a new dependency.
 *
 * Postgres COUNT on the (partner_id, timestamp) index is fast at our
 * current volume. When/if it becomes the bottleneck, P3.2's hourly rollup
 * gives us a pre-aggregated path to switch to.
 */
@Injectable()
export class PartnerRateLimitService {
  private readonly logger = new Logger(PartnerRateLimitService.name);
  private readonly orgLimitsCache = new Map<string, PartnerRateLimits>();
  private readonly orgTypeCache = new Map<string, string>();
  private lastCacheLoadAt = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    @InjectRepository(ApiUsageMetricEntity)
    private readonly metrics: Repository<ApiUsageMetricEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
  ) {}

  async check(partnerId: string): Promise<RateLimitResult> {
    await this.ensureCacheFresh();
    const limits = this.orgLimitsCache.get(partnerId) ?? DEFAULT_LIMITS;
    const now = new Date();

    // Minute window first — if that fails we can short-circuit without the
    // daily query.
    const minute = await this.checkWindow(partnerId, now, 60_000, limits.perMinute, 'minute');
    if (!minute.allowed) return minute;

    return this.checkWindow(partnerId, now, 24 * 60 * 60 * 1000, limits.perDay, 'day');
  }

  /**
   * True when the partner should be entirely skipped by the rate limiter.
   * Only first-party (internal) traffic bypasses — everyone else is limited.
   * The 'unknown' sentinel partner stays in the limiter so we cap anonymous
   * traffic too (otherwise a bad actor could just drop the Origin header).
   *
   * Note: an earlier revision skipped 'customer' orgs as well. That was a
   * bug — paying customer organizations must be limited by their plan, not
   * granted unlimited access.
   */
  async shouldSkip(partnerId: string): Promise<boolean> {
    await this.ensureCacheFresh();
    const type = this.orgTypeCache.get(partnerId);
    return type === 'internal';
  }

  private async checkWindow(
    partnerId: string,
    now: Date,
    windowMs: number,
    limit: number,
    granularity: 'minute' | 'day',
  ): Promise<RateLimitResult> {
    // A negative limit means "unlimited" (e.g. ENTERPRISE perDay=-1). Without
    // this short-circuit `count < -1` is always false → every unlimited-tier
    // partner gets 429 the moment enforcement (dry-run off) is enabled.
    if (limit < 0) {
      return {
        allowed: true,
        limit,
        remaining: -1,
        resetAt: new Date(now.getTime() + windowMs),
        granularity,
      };
    }
    const startTime = new Date(now.getTime() - windowMs);
    const count = await this.metrics.count({
      where: {
        partnerId,
        timestamp: MoreThan(startTime),
      },
    });
    const remaining = Math.max(0, limit - count);
    const resetAt = new Date(now.getTime() + windowMs);
    return {
      allowed: count < limit,
      limit,
      remaining,
      resetAt,
      granularity,
    };
  }

  private async ensureCacheFresh(): Promise<void> {
    if (Date.now() - this.lastCacheLoadAt < PartnerRateLimitService.CACHE_TTL_MS) return;
    const rows = await this.orgs.find({ select: ['id', 'type', 'plan', 'settings'] });
    const nextLimits = new Map<string, PartnerRateLimits>();
    const nextTypes = new Map<string, string>();
    for (const row of rows) {
      nextTypes.set(row.id, row.type as string);
      // getEffectiveLimits handles the full precedence chain (effectiveLimits
      // → legacy rateLimits → plan defaults). Only cache when the resolved
      // limits are tighter than the service default, otherwise fall through
      // to DEFAULT_LIMITS so unconfigured orgs aren't accidentally throttled
      // by a low plan tier they were never put on.
      const eff = getEffectiveLimits(row);
      if (eff.source === 'plan' || eff.source === 'override') {
        nextLimits.set(row.id, { perMinute: eff.perMinute, perDay: eff.perDay });
      }
    }
    this.orgLimitsCache.clear();
    for (const [k, v] of nextLimits) this.orgLimitsCache.set(k, v);
    this.orgTypeCache.clear();
    for (const [k, v] of nextTypes) this.orgTypeCache.set(k, v);
    this.lastCacheLoadAt = Date.now();
  }
}
