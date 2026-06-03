import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { SubscriptionEntity } from '../entities/subscription.entity';
import {
  EffectiveLimits,
  computeFromPlan,
} from '../types/effective-limits';

/**
 * Writes per-org `effectiveLimits` derived from the org's plan (or its
 * active Stripe subscription) into `organizations.settings.effectiveLimits`.
 *
 * Called from:
 *   - Stripe webhook handlers when subscription state changes (later PR)
 *   - The admin "force resync" endpoint
 *   - The Proto seed script after provisioning
 *
 * Does NOT push limits to running rate limiter caches; those refresh on
 * their own 5-minute TTL (PartnerRateLimitService.ensureCacheFresh).
 */
@Injectable()
export class SubscriptionLimitsSyncService {
  private readonly logger = new Logger(SubscriptionLimitsSyncService.name);

  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subs: Repository<SubscriptionEntity>,
  ) {}

  /**
   * Resolve which plan the org should be on (prefer the active subscription,
   * fall back to `org.plan`), compute limits, write back.
   */
  async syncFromPlan(organizationId: string): Promise<EffectiveLimits> {
    const org = await this.orgs.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundException(`Organization ${organizationId} not found`);

    const activePlan = await this.resolvePlanId(organizationId, org.plan);
    const limits = computeFromPlan(activePlan);
    if (!limits) {
      this.logger.warn(`syncFromPlan: org ${organizationId} has unknown plan "${activePlan}" — skipping write`);
      throw new NotFoundException(`Unknown plan: ${activePlan}`);
    }

    // Cast to satisfy TypeORM's _QueryDeepPartialEntity narrowing — settings
    // is a free-form jsonb column on the entity, but the update() typing
    // requires every nested value to be string-indexable.
    const settings: Record<string, any> = {
      ...(org.settings ?? {}),
      effectiveLimits: limits as unknown as Record<string, any>,
    };
    await this.orgs.update({ id: organizationId }, { settings });
    this.logger.log(
      `Synced effectiveLimits for ${organizationId} → plan=${limits.plan} perMin=${limits.perMinute} perMonth=${limits.requestsPerMonth}`,
    );
    return limits;
  }

  /**
   * Bootstrap path: sync every org that has an active subscription. Safe to
   * run at startup or from a one-shot script.
   */
  async syncAllActive(): Promise<{ synced: number; skipped: number }> {
    const orgs = await this.orgs.find({ where: { isActive: true } });
    let synced = 0;
    let skipped = 0;
    for (const org of orgs) {
      try {
        await this.syncFromPlan(org.id);
        synced++;
      } catch (err) {
        skipped++;
        this.logger.debug(`syncAllActive: skipped ${org.id}: ${(err as Error)?.message}`);
      }
    }
    return { synced, skipped };
  }

  /**
   * Active subscription wins over the legacy org.plan column. If multiple
   * active subscriptions exist (shouldn't happen, but just in case), prefer
   * the highest tier by Stripe price.
   */
  private async resolvePlanId(organizationId: string, fallback: string): Promise<string> {
    const sub = await this.subs.findOne({
      where: { organizationId, status: 'active' },
      order: { amount: 'DESC' },
    });
    return sub?.plan ?? fallback ?? 'FREE';
  }
}
