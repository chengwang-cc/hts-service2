import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * JurisdictionEntity - taxonomy of countries, customs unions, member states,
 * and territories used for landed-cost calculation.
 *
 * Examples:
 *   US (country)
 *   EU (customs_union)
 *   DE (member_state, parentCode='EU')
 *   HK (country)
 */
@Entity('jurisdictions')
@Index(['parentCode'])
@Index(['type'])
@Index(['isActive'])
export class JurisdictionEntity {
  /** ISO 3166-1 alpha-2 OR ISO-like code ('EU') */
  @PrimaryColumn('varchar', { length: 8 })
  code: string;

  @Column('varchar', { length: 255 })
  displayName: string;

  @Column('varchar', { length: 24 })
  type: 'country' | 'customs_union' | 'member_state' | 'territory';

  @Column('varchar', { length: 8, nullable: true })
  parentCode: string | null;

  @Column('varchar', { length: 8 })
  currencyCode: string;

  @Column('varchar', { length: 16, nullable: true })
  defaultLocale: string | null;

  /**
   * Tariff schema: 'HTS_10' (US), 'GB_10', 'TARIC_10', 'JP_9', 'KR_10',
   * 'TW_11', 'HK_FREE_PORT', 'HS_6' (generic 6-digit fallback).
   */
  @Column('varchar', { length: 32 })
  tariffSchema: string;

  @Column('boolean', { default: true })
  isActive: boolean;

  /**
   * W0.5.T3 (2026-05-26): country lifecycle state for the 11-country
   * rollout. Five values:
   *   - SOURCE_VALIDATION: hidden from public UI; admin-only dry-run
   *   - SHADOW: internal quotes run; user-facing destination hidden
   *   - BETA: visible to selected orgs with limitation banner
   *   - PRODUCTION: generally visible
   *   - PAUSED: destination hidden; API returns UnsupportedJurisdictionError
   *
   * Existing destinations seeded to 'PRODUCTION' on migration.
   * `pickForDestination()` returns UnsupportedJurisdictionError for PAUSED.
   */
  @Column('varchar', { length: 24, default: 'PRODUCTION' })
  countryState:
    | 'SOURCE_VALIDATION'
    | 'SHADOW'
    | 'BETA'
    | 'PRODUCTION'
    | 'PAUSED';

  /** Free-form metadata: timezone, regulator URLs, etc. */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
