import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { OrganizationsAdminService, UpdateOrgPatch } from '../services/organizations.admin.service';
import { SubscriptionLimitsSyncService } from '../../billing/services/subscription-limits-sync.service';
import { ApiKeyService } from '../../api-keys/services/api-key.service';
import { SubscriptionService } from '../../billing/services/subscription.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';

/**
 * Platform-admin organization management.
 *
 * Mounted at `/api/v1/admin/organizations`. Auth: JwtAuthGuard +
 * AdminGuard — caller must have a JWT whose user has an admin-tier role
 * (`admin`, `superadmin`, `Platform Administrator`) OR the `admin:*`
 * permission.
 *
 * Replaces the raw-SQL workflow that today is the only way to promote a
 * customer-typed org to `partner` (see
 * docs/2026-06-03/1217_portal-manual-validation-runbook.md §9). The
 * `:id/sync-limits` endpoint exists so the operator can re-derive
 * effectiveLimits without a code deploy after a Stripe-side plan change.
 */
@Controller('api/v1/admin/organizations')
@UseGuards(JwtAuthGuard, AdminGuard)
export class OrganizationsAdminController {
  constructor(
    private readonly orgs: OrganizationsAdminService,
    private readonly limitsSync: SubscriptionLimitsSyncService,
    private readonly apiKeyService: ApiKeyService,
    private readonly subscriptionService: SubscriptionService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  @Get()
  async list(
    @Query('type') type?: 'internal' | 'partner' | 'customer',
    @Query('plan') plan?: string,
    @Query('q') q?: string,
    @Query('isActive') isActive?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    const lim = clampInt(limit, 1, 200, 50);
    const off = clampInt(offset, 0, 100_000, 0);
    return this.orgs.list({
      type: type ?? undefined,
      plan: plan?.trim() ? plan.trim().toUpperCase() : undefined,
      q: q?.trim() ? q.trim() : undefined,
      isActive: parseBool(isActive),
      limit: lim,
      offset: off,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.orgs.findById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() patch: UpdateOrgPatch) {
    // Light-weight whitelist guard: reject unknown keys outright instead
    // of silently ignoring (the service whitelists too, but a 400 here
    // is a clearer signal to a misbehaving UI).
    const allowed = new Set(['name', 'slug', 'type', 'plan', 'isActive']);
    const extras = Object.keys(patch ?? {}).filter((k) => !allowed.has(k));
    if (extras.length) {
      throw new BadRequestException(`Disallowed fields in patch: ${extras.join(', ')}`);
    }
    return this.orgs.update(id, patch);
  }

  @Post(':id/sync-limits')
  async syncLimits(@Param('id') id: string) {
    try {
      const limits = await this.limitsSync.syncFromPlan(id);
      return { organizationId: id, effectiveLimits: limits };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new NotFoundException((err as Error)?.message ?? 'Failed to sync limits');
    }
  }

  @Get(':id/users')
  async listUsers(@Param('id') id: string) {
    const rows = await this.users.find({
      where: { organizationId: id },
      select: ['id', 'email', 'firstName', 'lastName', 'isActive', 'emailVerified', 'lastLoginAt', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
    return { organizationId: id, count: rows.length, items: rows };
  }

  @Get(':id/api-keys')
  async listApiKeys(@Param('id') id: string) {
    const keys = await this.apiKeyService.listApiKeys(id);
    // Explicitly select fields the admin UI uses; bypass any extras
    // (createdBy, updatedAt, ipWhitelist, metadata) that the frontend
    // doesn't declare. Especially important: never leak keyHash.
    const items = keys.map((k) => ({
      id: k.id,
      name: k.name,
      description: k.description,
      keyPrefix: k.keyPrefix,
      organizationId: k.organizationId,
      environment: k.environment,
      purpose: k.purpose,
      permissions: k.permissions,
      rateLimitPerMinute: k.rateLimitPerMinute,
      rateLimitPerDay: k.rateLimitPerDay,
      isActive: k.isActive,
      expiresAt: k.expiresAt,
      lastUsedAt: k.lastUsedAt,
      allowedOrigins: k.allowedOrigins,
      createdAt: k.createdAt,
    }));
    return { organizationId: id, count: items.length, items };
  }

  @Get(':id/subscription')
  async subscription(@Param('id') id: string) {
    const sub = await this.subscriptionService.getActiveSubscription(id);
    if (!sub) {
      return { organizationId: id, plan: 'FREE', status: 'active', subscription: null };
    }
    return { organizationId: id, plan: sub.plan, status: sub.status, subscription: sub };
  }
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

// Re-export so other admin controllers that want to type a body share the
// same patch shape.
export type { UpdateOrgPatch };
