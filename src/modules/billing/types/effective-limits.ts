import type { OrganizationEntity } from '../../auth/entities/organization.entity';
import { getPlanById } from '../config/plans.config';

/**
 * Per-partner enforced limits, derived from the active subscription plan and
 * persisted on `organizations.settings.effectiveLimits` for cache-friendly
 * reads from PartnerRateLimitService and EntitlementGuard.
 *
 * Single source of truth. PartnerRateLimitService and EntitlementGuard MUST
 * use this — never the static plan defaults directly — so a plan upgrade is
 * reflected within one cache-refresh interval (5 minutes).
 *
 * `-1` always means "unlimited" (mirrors PlanFeatures.api.requestsPerMonth).
 * `costUsdPerMonth: null` means "no $-cap" (separate from `-1`).
 */
export interface EffectiveLimits {
  perMinute: number;
  perDay: number;
  requestsPerMonth: number;
  costUsdPerMonth: number | null;
  source: 'plan' | 'override' | 'default';
  plan: string;
  syncedAt: string; // ISO8601
}

const DEFAULT_LIMITS: EffectiveLimits = {
  perMinute: 60,
  perDay: 10_000,
  requestsPerMonth: 1_000,
  costUsdPerMonth: null,
  source: 'default',
  plan: 'FREE',
  syncedAt: new Date(0).toISOString(),
};

/**
 * Resolve the effective limits for an organization.
 *
 *   1. `org.settings.effectiveLimits` (written by SubscriptionLimitsSyncService) — preferred.
 *   2. `org.settings.rateLimits` legacy override — back-compat for orgs not yet synced.
 *   3. Computed from `org.plan` via plans.config.ts — fallback if nothing is persisted.
 *   4. Static defaults — last resort.
 *
 * The fallback chain means a brand-new org without a sync record still gets
 * a sane limit; no need to backfill before deploying EntitlementGuard.
 */
export function getEffectiveLimits(org: OrganizationEntity | null | undefined): EffectiveLimits {
  if (!org) return DEFAULT_LIMITS;

  const stored = readStored(org.settings);
  if (stored) return stored;

  const fromPlan = computeFromPlan(org.plan);
  if (fromPlan) return fromPlan;

  return DEFAULT_LIMITS;
}

/**
 * Compute limits from a plan id without touching the org row. Used by
 * SubscriptionLimitsSyncService when persisting; also the public path for
 * EntitlementGuard to "what would limits be if we upgraded?".
 */
export function computeFromPlan(planId: string | null | undefined): EffectiveLimits | null {
  if (!planId) return null;
  const plan = getPlanById(planId);
  if (!plan) return null;
  return {
    perMinute: plan.features.api.rateLimit.perMinute,
    perDay: plan.features.api.rateLimit.perDay,
    requestsPerMonth: plan.features.api.requestsPerMonth,
    costUsdPerMonth: null,
    source: 'plan',
    plan: plan.id,
    syncedAt: new Date().toISOString(),
  };
}

function readStored(settings: Record<string, any> | null | undefined): EffectiveLimits | null {
  if (!settings || typeof settings !== 'object') return null;

  const stored = (settings as { effectiveLimits?: unknown }).effectiveLimits;
  if (stored && typeof stored === 'object') {
    const obj = stored as Partial<EffectiveLimits>;
    if (
      typeof obj.perMinute === 'number' &&
      typeof obj.perDay === 'number' &&
      typeof obj.requestsPerMonth === 'number'
    ) {
      return {
        perMinute: obj.perMinute,
        perDay: obj.perDay,
        requestsPerMonth: obj.requestsPerMonth,
        costUsdPerMonth:
          typeof obj.costUsdPerMonth === 'number' ? obj.costUsdPerMonth : null,
        source: obj.source === 'override' ? 'override' : 'plan',
        plan: typeof obj.plan === 'string' ? obj.plan : 'UNKNOWN',
        syncedAt: typeof obj.syncedAt === 'string' ? obj.syncedAt : new Date(0).toISOString(),
      };
    }
  }

  // Legacy: org.settings.rateLimits = { perMinute, perDay }
  const legacy = (settings as { rateLimits?: unknown }).rateLimits;
  if (legacy && typeof legacy === 'object') {
    const obj = legacy as { perMinute?: unknown; perDay?: unknown };
    if (typeof obj.perMinute === 'number' && typeof obj.perDay === 'number') {
      return {
        perMinute: obj.perMinute,
        perDay: obj.perDay,
        requestsPerMonth: -1, // legacy didn't track this; treat as unlimited
        costUsdPerMonth: null,
        source: 'override',
        plan: 'LEGACY_OVERRIDE',
        syncedAt: new Date(0).toISOString(),
      };
    }
  }

  return null;
}
