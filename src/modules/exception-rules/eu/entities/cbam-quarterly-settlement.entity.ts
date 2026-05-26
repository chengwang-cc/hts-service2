import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * CbamQuarterlySettlementEntity (D7 fix, 2026-05-27).
 *
 * Persists every quote's CBAM provisional contribution so the
 * `/admin/eu/cbam/quarterly-report` endpoint can aggregate across
 * replicas and survive restarts. One row per `(quoteId, hts, sector)`
 * tuple.
 *
 * To materialize the table:
 *   scripts/generate-migration.sh cbam-quarterly-settlement
 *   scripts/run-migration.sh
 */
@Entity('cbam_quarterly_settlements')
@Index(['quarter'])
@Index(['quarter', 'sector'])
@Index(['quoteId'])
@Index(['observedAt'])
export class CbamQuarterlySettlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Bucket key `YYYY-Qn` (e.g. `2026-Q2`). */
  @Column('varchar', { length: 8 })
  quarter: string;

  @Column('varchar', { length: 100 })
  quoteId: string;

  @Column('varchar', { length: 20 })
  htsCode: string;

  /**
   * cement | iron_steel | aluminum | fertilizers | electricity | hydrogen | unknown
   */
  @Column('varchar', { length: 32 })
  sector: string;

  @Column('boolean', { default: true })
  defaultApplied: boolean;

  /** Number of CBAM certificates implied by this quote line. */
  @Column('decimal', { precision: 18, scale: 6 })
  cbamCertificates: number;

  /** Cost in EUR (= cbamCertificates × certificate-price). */
  @Column('decimal', { precision: 18, scale: 4 })
  provisionalCostEur: number;

  @Column('timestamptz')
  observedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
