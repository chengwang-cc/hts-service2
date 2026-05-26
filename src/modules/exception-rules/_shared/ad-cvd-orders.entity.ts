import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * AdCvdOrderEntity (Phase 6, P6.T5 — stub).
 *
 * Anti-Dumping (AD) and Countervailing Duty (CVD) orders are issued by
 * the importing country's investigating agency (USITC/USDOC, EU, CBSA,
 * TRA, MBIE, ADC, KFTC, MOEA, etc.). Each order is typically:
 *
 *   - per HTS family (or specific list of HTS codes)
 *   - per origin country
 *   - per exporter (with an "all others" fallback rate)
 *   - cash-deposit at a percentage of the entered value
 *
 * This entity is the integration surface for Phase 9 data import.
 * Phase 6 ships the table empty + per-jurisdiction stub rules that look
 * up against it and emit zero components when no row matches.
 *
 * The schema deliberately keeps the matching keys simple:
 *   - `destinationCountry` + `htsCode` (prefix-matched at query time)
 *   - `originCountry`
 *   - optional `exporterName` for per-exporter rates
 *   - `cashDepositRate` as decimal (e.g. 0.456 = 45.6%)
 *
 * To materialize the table:
 *   scripts/generate-migration.sh ad-cvd-orders
 *   scripts/run-migration.sh
 */
@Entity('ad_cvd_orders')
@Index(['destinationCountry', 'htsCode'])
@Index(['destinationCountry', 'originCountry'])
@Index(['orderCaseNumber'])
export class AdCvdOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ISO-2 importing country (US, CA, UK, EU, AU, NZ, etc.). */
  @Column('varchar', { length: 4 })
  destinationCountry: string;

  /** 6- or 10-digit HTS / HS code (prefix match at query time). */
  @Column('varchar', { length: 20 })
  htsCode: string;

  /** ISO-2 origin country the order targets. */
  @Column('varchar', { length: 4 })
  originCountry: string;

  /** Exporter name (free-text); null = "all others" rate. */
  @Column('varchar', { length: 200, nullable: true })
  exporterName: string | null;

  /** AD case number per agency (e.g. "A-570-979"). */
  @Column('varchar', { length: 50 })
  orderCaseNumber: string;

  /**
   * Trade-remedy order type. Originally {AD, CVD, AD+CVD}; extended
   * 2026-05-26 (W0.5.T4) to also cover safeguard + countermeasure orders
   * so a single `ad_cvd_orders` table can back every per-country
   * trade-remedy lookup without parallel tables.
   *   - AD / CVD / AD+CVD: Anti-dumping / countervailing
   *   - SAFEGUARD: Section 201-style safeguard duties (US, GB, EU, IN, ID)
   *   - COUNTERMEASURE: Retaliatory / counter-tariff orders (CN, CA)
   */
  @Column('varchar', { length: 16 })
  orderType: 'AD' | 'CVD' | 'AD+CVD' | 'SAFEGUARD' | 'COUNTERMEASURE';

  /** Cash-deposit rate as decimal (0.456 = 45.6%). */
  @Column('decimal', { precision: 8, scale: 6 })
  cashDepositRate: number;

  /** Effective from (inclusive). */
  @Column('timestamptz')
  effectiveFrom: Date;

  /** Effective to (exclusive); null = open-ended. */
  @Column('timestamptz', { nullable: true })
  effectiveTo: Date | null;

  /** Source citation (knowledge card key / URL). */
  @Column('varchar', { length: 200 })
  source: string;

  /** Free-text product description (for the breakdown row description). */
  @Column('text', { nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
