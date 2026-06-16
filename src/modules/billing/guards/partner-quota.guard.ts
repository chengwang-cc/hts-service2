import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request, Response } from 'express';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { PartnerUsageMonthlyEntity } from '../../partner-attribution/entities/partner-usage-monthly.entity';
import type { RequestAttribution } from '../../partner-attribution/types';
import { getEffectiveLimits } from '../types/effective-limits';
import { SKIP_ENTITLEMENT_KEY } from '../decorators/skip-entitlement.decorator';
import {
  type IQuotaCache,
  type QuotaSnapshot,
  QUOTA_CACHE,
} from '../services/quota-cache.service';

/**
 * Monthly-quota enforcement against the partner's subscription plan.
 *
 * Runs AFTER ApiKeyGuard and AFTER AttributionMiddleware. Reads:
 *   - req.attribution.partnerId (set by middleware)
 *   - effectiveLimits.requestsPerMonth (per-org, plan-derived)
 *   - partner_usage_monthly counts for the current calendar month
 *
 * Returns 402 Payment Required when the partner is over their plan quota.
 * Per-minute / per-day rate limits stay on PartnerRateLimitMiddleware (429).
 *
 * Distinct from the existing JWT-user-scoped EntitlementGuard in the same
 * directory — that one checks per-feature flags for dashboard sessions;
 * this one checks per-partner monthly request counts for API traffic.
 *
 * Behaviour at the boundary:
 *   - First request that crosses the limit IS allowed through (we read the
 *     pre-aggregated count, not the live counter). Off-by-N at the boundary
 *     is acceptable — saves a DB round-trip per request.
 *   - Failed lookups (DB error, no org found) FAIL OPEN. The guard is a
 *     billing concern, not a security boundary; ApiKeyGuard already
 *     authenticated the caller. A 500 here would block paying customers
 *     during a DB hiccup, which is worse than over-serving.
 *
 * Cache: 60s TTL keyed by partnerId. Monthly quota is naturally slow-moving,
 * so 60s lag is fine and saves a DB round-trip per request.
 */
@Injectable()
export class PartnerQuotaGuard implements CanActivate {
  private readonly logger = new Logger(PartnerQuotaGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(PartnerUsageMonthlyEntity)
    private readonly monthly: Repository<PartnerUsageMonthlyEntity>,
    // Backend-agnostic cache. Memory in single-task deploys, Redis in
    // multi-task deploys. Pick via QUOTA_BACKEND env. See
    // quota-cache.service.ts for rationale.
    @Inject(QUOTA_CACHE) private readonly cache: IQuotaCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENTITLEMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const attribution = req.attribution as RequestAttribution | undefined;
    const partnerId = attribution?.partnerId;
    if (!partnerId) return true;

    let quota: QuotaSnapshot;
    try {
      quota = await this.getQuota(partnerId);
    } catch (err) {
      this.logger.warn(
        `PartnerQuotaGuard fail-open for ${partnerId}: ${(err as Error)?.message}`,
      );
      return true;
    }

    // Internal orgs bypass quota enforcement entirely (first-party traffic).
    if (quota.orgType === 'internal') return true;

    const { limits } = quota;

    this.setQuotaHeaders(res, quota);

    if (limits.requestsPerMonth !== -1 && quota.requestsThisMonth >= limits.requestsPerMonth) {
      throw this.quotaExceeded(
        'api.requestsPerMonth',
        quota.requestsThisMonth,
        limits.requestsPerMonth,
        limits.plan,
      );
    }

    if (
      limits.costUsdPerMonth !== null &&
      quota.costUsdThisMonth >= limits.costUsdPerMonth
    ) {
      throw this.quotaExceeded(
        'api.costUsdPerMonth',
        quota.costUsdThisMonth,
        limits.costUsdPerMonth,
        limits.plan,
      );
    }

    return true;
  }

  private setQuotaHeaders(res: Response, quota: QuotaSnapshot): void {
    const { limits, requestsThisMonth } = quota;
    res.setHeader('X-Quota-Plan', limits.plan);
    res.setHeader('X-Quota-Limit-Month', String(limits.requestsPerMonth));
    res.setHeader('X-Quota-Used-Month', String(requestsThisMonth));
    if (limits.requestsPerMonth !== -1) {
      const remaining = Math.max(0, limits.requestsPerMonth - requestsThisMonth);
      res.setHeader('X-Quota-Remaining-Month', String(remaining));
      const pctUsed = (requestsThisMonth / limits.requestsPerMonth) * 100;
      if (pctUsed >= 90 && pctUsed < 100) {
        res.setHeader('X-Quota-Warning', '90');
      }
    }
  }

  private quotaExceeded(
    metric: string,
    usage: number,
    limit: number,
    plan: string,
  ): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'QuotaExceeded',
        metric,
        usage,
        limit,
        plan,
        message: `Monthly quota exceeded for ${metric}. Used ${usage} of ${limit} on the ${plan} plan.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  private async getQuota(partnerId: string): Promise<QuotaSnapshot> {
    const cached = await this.cache.get(partnerId);
    if (cached) return cached;

    const org = await this.orgs.findOne({ where: { id: partnerId } });
    const limits = getEffectiveLimits(org);
    const orgType = org?.type ?? 'customer';

    const totals = await this.fetchMonthTotals(partnerId);

    const snapshot: QuotaSnapshot = {
      limits,
      orgType,
      requestsThisMonth: totals.requests,
      costUsdThisMonth: totals.costUsd,
      syncedAt: Date.now(),
    };
    // Fire-and-forget: a Redis hiccup must not 500 the request path.
    // RedisQuotaCache.set() already swallows errors at debug.
    void this.cache.set(partnerId, snapshot);
    return snapshot;
  }

  private async fetchMonthTotals(partnerId: string): Promise<{ requests: number; costUsd: number }> {
    const rows: Array<{ requests: string | null; cost_usd: string | null }> =
      await this.monthly.manager.query(
        `SELECT COALESCE(SUM(requests), 0)::text AS requests,
                COALESCE(SUM(cost_usd), 0)::text AS cost_usd
         FROM partner_usage_monthly
         WHERE partner_id = $1
           AND bucket_month = date_trunc('month', now())::date`,
        [partnerId],
      );
    const requests = Number(rows[0]?.requests ?? '0');
    const costUsd = Number(rows[0]?.cost_usd ?? '0');
    return {
      requests: Number.isFinite(requests) ? requests : 0,
      costUsd: Number.isFinite(costUsd) ? costUsd : 0,
    };
  }
}
