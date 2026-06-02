import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { ApiUsageMetricEntity } from '../../api-keys/entities/api-usage-metric.entity';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  granularity: 'minute' | 'day';
}

/**
 * Per-partner rate limit overrides live on `organizations.settings.rateLimits`.
 * The shape is intentionally identical to the api_keys columns for symmetry.
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
   * True when the partner should be entirely skipped by the rate limiter
   * (internal partner OR unmatched 'unknown' sentinel — the latter falls
   * back to the existing IP-based limiter elsewhere).
   */
  async shouldSkip(partnerId: string): Promise<boolean> {
    await this.ensureCacheFresh();
    const type = this.orgTypeCache.get(partnerId);
    return type === 'internal' || type === 'customer';
  }

  private async checkWindow(
    partnerId: string,
    now: Date,
    windowMs: number,
    limit: number,
    granularity: 'minute' | 'day',
  ): Promise<RateLimitResult> {
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
    const rows = await this.orgs.find({ select: ['id', 'type', 'settings'] });
    const nextLimits = new Map<string, PartnerRateLimits>();
    const nextTypes = new Map<string, string>();
    for (const row of rows) {
      nextTypes.set(row.id, row.type as string);
      const override = this.extractLimits(row.settings);
      if (override) nextLimits.set(row.id, override);
    }
    this.orgLimitsCache.clear();
    for (const [k, v] of nextLimits) this.orgLimitsCache.set(k, v);
    this.orgTypeCache.clear();
    for (const [k, v] of nextTypes) this.orgTypeCache.set(k, v);
    this.lastCacheLoadAt = Date.now();
  }

  private extractLimits(settings: Record<string, unknown> | null): PartnerRateLimits | null {
    if (!settings || typeof settings !== 'object') return null;
    const raw = (settings as { rateLimits?: unknown }).rateLimits;
    if (!raw || typeof raw !== 'object') return null;
    const perMinute = Number((raw as { perMinute?: unknown }).perMinute);
    const perDay = Number((raw as { perDay?: unknown }).perDay);
    if (!Number.isFinite(perMinute) || !Number.isFinite(perDay)) return null;
    if (perMinute < 1 || perDay < 1) return null;
    return { perMinute, perDay };
  }
}
