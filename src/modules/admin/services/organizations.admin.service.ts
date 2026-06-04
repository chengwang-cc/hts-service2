import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { SubscriptionLimitsSyncService } from '../../billing/services/subscription-limits-sync.service';
import {
  EffectiveLimits,
  getEffectiveLimits,
} from '../../billing/types/effective-limits';

export interface ListOrgsInput {
  type?: 'internal' | 'partner' | 'customer';
  plan?: string;
  q?: string;
  isActive?: boolean;
  limit: number;
  offset: number;
}

export interface OrganizationListItem {
  id: string;
  name: string;
  slug: string | null;
  type: string;
  plan: string;
  isActive: boolean;
  userCount: number;
  apiKeyCount: number;
  createdAt: Date;
}

export interface OrganizationDetail extends OrganizationListItem {
  effectiveLimits: EffectiveLimits;
  updatedAt: Date;
}

export interface OrganizationListResponse {
  total: number;
  items: OrganizationListItem[];
}

/**
 * Fields a platform admin can mutate via PATCH /admin/organizations/:id.
 *
 * Deliberately narrow: settings + usageQuotas are excluded so that admin
 * UI clicks can't accidentally wipe the effectiveLimits snapshot or
 * Stripe metadata that lives in `settings`. To change limits, call
 * sync-limits explicitly — that path is whitelisted and audited.
 */
export interface UpdateOrgPatch {
  name?: string;
  slug?: string | null;
  type?: 'internal' | 'partner' | 'customer';
  plan?: string;
  isActive?: boolean;
}

/**
 * Body shape for PUT /admin/organizations/:id/limits — the platform
 * admin's "give this org a custom limit, ignore their plan" lever.
 * Service writes the resulting EffectiveLimits with source='override',
 * which then takes precedence over the plan-derived computation in
 * getEffectiveLimits().
 *
 *   requestsPerMonth: -1   → unlimited monthly (no PartnerQuotaGuard cap)
 *   costUsdPerMonth: null  → no dollar cap
 *
 * Both per-minute and per-day must be positive integers — those are
 * sliding-window rate limits, not monthly caps; -1 isn't meaningful
 * there. For "effectively unlimited" set them to e.g. 999_999 / 9_999_999.
 */
export interface SetLimitsInput {
  perMinute: number;
  perDay: number;
  requestsPerMonth: number;
  costUsdPerMonth: number | null;
}

@Injectable()
export class OrganizationsAdminService {
  private readonly logger = new Logger(OrganizationsAdminService.name);

  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly limitsSync: SubscriptionLimitsSyncService,
  ) {}

  async list(input: ListOrgsInput): Promise<OrganizationListResponse> {
    const qb = this.orgs.createQueryBuilder('o');

    if (input.type) qb.andWhere('o.type = :type', { type: input.type });
    if (input.plan) qb.andWhere('o.plan = :plan', { plan: input.plan });
    if (typeof input.isActive === 'boolean') {
      qb.andWhere('o.isActive = :isActive', { isActive: input.isActive });
    }
    if (input.q) {
      const q = `%${input.q.toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(o.name) LIKE :q OR LOWER(o.slug) LIKE :q OR o.id::text = :exact)',
        { q, exact: input.q },
      );
    }

    // Inline aggregate counts via correlated subqueries — one round-trip
    // for everything instead of (1 + 2N) queries. The previous
    // decorateListItem pattern ran a per-row users.count() and a per-row
    // api_keys count; for a 50-row page that's 101 extra round-trips.
    qb.addSelect(
      `(SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id)::int`,
      'user_count',
    );
    qb.addSelect(
      `(SELECT COUNT(*) FROM api_keys k WHERE k.organization_id = o.id AND k.is_active = true)::int`,
      'api_key_count',
    );

    qb.orderBy('o.createdAt', 'DESC').take(input.limit).skip(input.offset);

    // getRawAndEntities returns the entity-mapped rows AND the underlying
    // raw row (which carries the addSelect aliases — `user_count`,
    // `api_key_count`). getCount() runs a separate count-of-filtered query
    // ignoring LIMIT/OFFSET; that's the second and final round-trip.
    const { entities, raw } = await qb.getRawAndEntities();
    const total = await qb.getCount();

    const items: OrganizationListItem[] = entities.map((org, idx) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      type: org.type,
      plan: org.plan,
      isActive: org.isActive,
      userCount: Number(raw[idx]?.user_count ?? 0),
      apiKeyCount: Number(raw[idx]?.api_key_count ?? 0),
      createdAt: org.createdAt,
    }));

    return { total, items };
  }

  async findById(id: string): Promise<OrganizationDetail> {
    const org = await this.orgs.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);

    const [userCount, apiKeyCount] = await Promise.all([
      this.users.count({ where: { organizationId: org.id } }),
      this.countActiveApiKeys(org.id),
    ]);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      type: org.type,
      plan: org.plan,
      isActive: org.isActive,
      userCount,
      apiKeyCount,
      createdAt: org.createdAt,
      effectiveLimits: getEffectiveLimits(org),
      updatedAt: org.updatedAt,
    };
  }

  /**
   * Apply a whitelisted patch. When `plan` or `type` changes, force a
   * `syncFromPlan` so the org's effectiveLimits snapshot stays coherent
   * with the new state.
   *
   * `actingUserOrgId` is the org of the admin performing the update —
   * we use it to block self-deactivation. Locking yourself out via a
   * fat-fingered `isActive: false` would be incredibly tedious to
   * recover from (you'd need shell access to flip it back), so we
   * just refuse.
   */
  async update(
    id: string,
    patch: UpdateOrgPatch,
    actingUserOrgId?: string,
  ): Promise<OrganizationDetail> {
    const org = await this.orgs.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);

    if (
      patch.isActive === false &&
      actingUserOrgId &&
      actingUserOrgId === id
    ) {
      throw new BadRequestException(
        'cannot deactivate your own organization — ask another admin or use a separate account',
      );
    }

    const before = { plan: org.plan, type: org.type };

    if (typeof patch.name === 'string') {
      const trimmed = patch.name.trim();
      if (trimmed) org.name = trimmed.slice(0, 255);
    }
    if (patch.slug !== undefined) {
      org.slug = patch.slug ? patch.slug.trim().slice(0, 64) : null;
    }
    if (patch.type !== undefined) {
      if (!['internal', 'partner', 'customer'].includes(patch.type)) {
        // BadRequest (not NotFound) — the type value is invalid, not a
        // resource that's missing.
        throw new BadRequestException(`Invalid organization type: ${patch.type}`);
      }
      org.type = patch.type;
    }
    if (patch.plan !== undefined) {
      const normalized = patch.plan.trim().toUpperCase();
      if (!normalized) {
        // Empty / whitespace-only — earlier this would set org.plan='' and
        // silently fail the syncFromPlan that followed.
        throw new BadRequestException('plan must be a non-empty string');
      }
      org.plan = normalized;
    }
    if (typeof patch.isActive === 'boolean') {
      org.isActive = patch.isActive;
    }

    try {
      await this.orgs.save(org);
    } catch (err) {
      // Duplicate slug surfaces as the Postgres 23505 unique_violation.
      // Re-raise as a 409 so the operator sees an actionable message
      // instead of a generic 500.
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        throw new ConflictException(
          `slug "${org.slug ?? ''}" is already in use by another organization`,
        );
      }
      throw err;
    }
    this.logger.log(
      `admin updated org ${id}: ${JSON.stringify({ before, patch })}`,
    );

    // Re-sync effective limits whenever the plan or type changes — both
    // affect what limits should apply.
    if (
      (patch.plan !== undefined && patch.plan !== before.plan) ||
      (patch.type !== undefined && patch.type !== before.type)
    ) {
      try {
        await this.limitsSync.syncFromPlan(id);
      } catch (err) {
        this.logger.warn(
          `post-update syncFromPlan failed for org ${id}: ${(err as Error)?.message}`,
        );
      }
    }

    return this.findById(id);
  }

  /**
   * Set an explicit per-org limits override. Writes to
   * `org.settings.effectiveLimits` with `source: 'override'`, which
   * takes precedence over the plan-derived limits in
   * `getEffectiveLimits()` and is read by PartnerRateLimitService and
   * PartnerQuotaGuard on their 5-min cache cycle.
   *
   * Use this to grant a partner / customer unlimited free usage
   * (`requestsPerMonth: -1`, `costUsdPerMonth: null`) or to throttle a
   * misbehaving caller below their plan's defaults.
   */
  async setLimitsOverride(id: string, input: SetLimitsInput): Promise<EffectiveLimits> {
    validateSetLimitsInput(input);
    const org = await this.orgs.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);

    const override: EffectiveLimits = {
      perMinute: Math.floor(input.perMinute),
      perDay: Math.floor(input.perDay),
      requestsPerMonth:
        input.requestsPerMonth === -1 ? -1 : Math.floor(input.requestsPerMonth),
      costUsdPerMonth:
        input.costUsdPerMonth === null ? null : Number(input.costUsdPerMonth),
      source: 'override',
      // Preserve the plan tag for traceability — handy for "this customer
      // is on STARTER but with a comp override" admin notes.
      plan: org.plan,
      syncedAt: new Date().toISOString(),
    };

    // Cast through `any` to satisfy TypeORM's _QueryDeepPartialEntity
    // narrowing on jsonb columns — same shape it already accepts, just
    // typed wider than the strict interface allows.
    const settings: Record<string, any> = {
      ...(org.settings ?? {}),
      effectiveLimits: override as unknown as Record<string, any>,
    };
    await this.orgs.update({ id }, { settings });
    this.logger.log(
      `admin set limits override for org ${id}: ${JSON.stringify(override)}`,
    );
    return override;
  }

  /**
   * Drop a previously-set override. Re-runs `syncFromPlan` so the org
   * lands back on plan-derived limits with `source: 'plan'`.
   */
  async clearLimitsOverride(id: string): Promise<EffectiveLimits> {
    const org = await this.orgs.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);

    // Remove the override key; preserve the rest of settings.
    if (org.settings && 'effectiveLimits' in org.settings) {
      const { effectiveLimits: _drop, ...rest } = org.settings as Record<string, any>;
      await this.orgs.update({ id }, { settings: rest as Record<string, any> });
    }

    // Re-derive from plan so the org has a coherent snapshot — same
    // path the standard PATCH-and-resync flow uses.
    const synced = await this.limitsSync.syncFromPlan(id);
    this.logger.log(`admin cleared limits override for org ${id}; resynced from plan ${synced.plan}`);
    return synced;
  }

  private async countActiveApiKeys(orgId: string): Promise<number> {
    try {
      const rows: Array<{ n: number }> = await this.orgs.manager.query(
        `SELECT COUNT(*)::int AS n FROM api_keys WHERE organization_id = $1 AND is_active = true`,
        [orgId],
      );
      return rows[0]?.n ?? 0;
    } catch {
      return 0;
    }
  }

}

/**
 * Validate the PUT /admin/organizations/:id/limits body.
 *
 *   perMinute, perDay      — sliding-window rate limits; positive integers.
 *                            Anything < 1 would block the org entirely.
 *   requestsPerMonth       — -1 means unlimited; otherwise non-negative
 *                            integer.
 *   costUsdPerMonth        — null means no $-cap; otherwise non-negative.
 *
 * Throws BadRequestException with a per-field message so the admin UI
 * can show actionable validation feedback.
 */
function validateSetLimitsInput(input: SetLimitsInput): void {
  if (!input || typeof input !== 'object') {
    throw new BadRequestException('limits body required');
  }
  if (!Number.isFinite(input.perMinute) || input.perMinute < 1 || input.perMinute > 100_000) {
    throw new BadRequestException('perMinute must be an integer in [1, 100000]');
  }
  if (!Number.isFinite(input.perDay) || input.perDay < 1 || input.perDay > 100_000_000) {
    throw new BadRequestException('perDay must be an integer in [1, 100000000]');
  }
  if (
    !Number.isFinite(input.requestsPerMonth) ||
    (input.requestsPerMonth < 0 && input.requestsPerMonth !== -1)
  ) {
    throw new BadRequestException(
      'requestsPerMonth must be -1 (unlimited) or a non-negative integer',
    );
  }
  if (
    input.costUsdPerMonth !== null &&
    (!Number.isFinite(input.costUsdPerMonth) || input.costUsdPerMonth < 0)
  ) {
    throw new BadRequestException(
      'costUsdPerMonth must be null (no cap) or a non-negative number',
    );
  }
}
