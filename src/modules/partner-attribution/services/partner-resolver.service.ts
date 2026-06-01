import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

/**
 * Per-partner config the AttributionMiddleware needs at request time.
 * Currently just the JWT shared secret for verifying X-Partner-User-Token;
 * P3 will add per-partner rate-limit overrides here too.
 */
export interface PartnerConfig {
  organizationId: string;
  slug: string | null;
  /**
   * Shared secret the partner signs their end-user JWTs with. Plaintext
   * in memory (DB column should be encrypted at rest in P2.x — secret in
   * Secrets Manager). Optional — null means JWT path is disabled for this
   * partner; X-Partner-User-Token will be ignored.
   */
  jwtSecret: string | null;
}

/**
 * Caches the lookup of the special-purpose partner rows by `slug`. Used by
 * the AttributionMiddleware to find the `unknown` fallback partner without
 * hitting the DB on every request.
 *
 * Cache is warmed on boot. Slugs are stable so we never invalidate — restart
 * to pick up changes (acceptable for these sentinel rows).
 */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class PartnerResolverService implements OnModuleInit {
  private readonly logger = new Logger(PartnerResolverService.name);
  private slugToId = new Map<string, string>();
  private configById = new Map<string, PartnerConfig>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.warm();
    this.refreshTimer = setInterval(() => {
      this.warm().catch((err) =>
        this.logger.error(`Partner resolver refresh failed: ${err?.message ?? err}`),
      );
    }, REFRESH_INTERVAL_MS);
  }

  async warm(): Promise<void> {
    const rows = await this.orgRepo.find({
      where: [{ type: 'partner' }, { type: 'internal' }, { slug: 'unknown' }],
      select: ['id', 'slug', 'settings'],
    });
    const nextSlug = new Map<string, string>();
    const nextConfig = new Map<string, PartnerConfig>();
    for (const row of rows) {
      if (row.slug) nextSlug.set(row.slug, row.id);
      nextConfig.set(row.id, {
        organizationId: row.id,
        slug: row.slug,
        jwtSecret: this.extractJwtSecret(row.settings),
      });
    }
    this.slugToId = nextSlug;
    this.configById = nextConfig;
    this.logger.log(
      `Partner resolver warmed: ${nextSlug.size} slugs (${[...nextSlug.keys()].join(', ')})`,
    );
  }

  /**
   * Look up the partner organization id for the catch-all 'unknown' partner.
   * Returns null if seeds haven't been run yet — caller must handle gracefully.
   */
  unknownPartnerId(): string | null {
    return this.slugToId.get('unknown') ?? null;
  }

  /** Look up any partner by slug. */
  partnerIdBySlug(slug: string): string | null {
    return this.slugToId.get(slug) ?? null;
  }

  /** Resolve the cached config for a partner. Null if the partner isn't known. */
  configForPartner(organizationId: string): PartnerConfig | null {
    return this.configById.get(organizationId) ?? null;
  }

  /**
   * The JWT secret lives at organizations.settings.jwtSecret in P2.
   * P2.x will move this to Secrets Manager and store only a hash in the
   * DB row, but the loader here stays the same shape.
   */
  private extractJwtSecret(settings: Record<string, unknown> | null): string | null {
    if (!settings || typeof settings !== 'object') return null;
    const v = (settings as { jwtSecret?: unknown }).jwtSecret;
    return typeof v === 'string' && v.length > 0 ? v : null;
  }
}
