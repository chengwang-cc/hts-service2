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

    qb.orderBy('o.createdAt', 'DESC').take(input.limit).skip(input.offset);

    const [rows, total] = await qb.getManyAndCount();
    const items = await Promise.all(rows.map((row) => this.decorateListItem(row)));
    return { total, items };
  }

  async findById(id: string): Promise<OrganizationDetail> {
    const org = await this.orgs.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);

    const item = await this.decorateListItem(org);
    return {
      ...item,
      effectiveLimits: getEffectiveLimits(org),
      updatedAt: org.updatedAt,
    };
  }

  /**
   * Apply a whitelisted patch. When `plan` or `type` changes, force a
   * `syncFromPlan` so the org's effectiveLimits snapshot stays coherent
   * with the new state.
   */
  async update(id: string, patch: UpdateOrgPatch): Promise<OrganizationDetail> {
    const org = await this.orgs.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);

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

  private async decorateListItem(org: OrganizationEntity): Promise<OrganizationListItem> {
    const [userCount, apiKeyCount] = await Promise.all([
      this.users.count({ where: { organizationId: org.id } }),
      this.orgs.manager
        .query(
          `SELECT COUNT(*)::int AS n FROM api_keys WHERE organization_id = $1 AND is_active = true`,
          [org.id],
        )
        .then((rows: Array<{ n: number }>) => rows[0]?.n ?? 0)
        .catch(() => 0),
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
    };
  }
}
