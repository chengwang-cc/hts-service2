import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

/**
 * Caches the lookup of the special-purpose partner rows by `slug`. Used by
 * the AttributionMiddleware to find the `unknown` fallback partner without
 * hitting the DB on every request.
 *
 * Cache is warmed on boot. Slugs are stable so we never invalidate — restart
 * to pick up changes (acceptable for these sentinel rows).
 */
@Injectable()
export class PartnerResolverService implements OnModuleInit {
  private readonly logger = new Logger(PartnerResolverService.name);
  private slugToId = new Map<string, string>();

  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.warm();
  }

  async warm(): Promise<void> {
    const rows = await this.orgRepo.find({
      where: [{ type: 'partner' }, { type: 'internal' }],
      select: ['id', 'slug'],
    });
    this.slugToId.clear();
    for (const row of rows) {
      if (row.slug) this.slugToId.set(row.slug, row.id);
    }
    // Also load the 'unknown' sentinel (type='customer' but specially-named).
    const unknown = await this.orgRepo.findOne({ where: { slug: 'unknown' } });
    if (unknown) this.slugToId.set('unknown', unknown.id);
    this.logger.log(
      `Partner resolver warmed: ${this.slugToId.size} slugs (${[...this.slugToId.keys()].join(', ')})`,
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
}
