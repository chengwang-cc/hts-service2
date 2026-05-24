import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * LandedCostQuoteEntity - one row per `POST /landed-cost/quotes` call.
 *
 * Persists the full request + response snapshot, plus all rule version IDs
 * needed to make the quote reproducible (HTS snapshot, fee/tax/low-value
 * snapshot IDs, exchange-rate snapshot, formula IDs).
 */
@Entity('landed_cost_quotes')
@Index(['organizationId', 'idempotencyKey'], { unique: true })
@Index(['organizationId', 'status'])
@Index(['expiresAt'])
@Index(['createdAt'])
export class LandedCostQuoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid', { nullable: true })
  apiKeyId: string | null;

  @Column('varchar', { length: 128, nullable: true })
  idempotencyKey: string | null;

  /** 'calculated' | 'confirmed' | 'expired' | 'failed' | 'requires_review' */
  @Column('varchar', { length: 24, default: 'calculated' })
  status: string;

  @Column('jsonb')
  requestJson: Record<string, any>;

  @Column('jsonb')
  responseJson: Record<string, any>;

  /** Per-jurisdiction HTS snapshot id used. JSON map: { US: 'snap-uuid', GB: '...' } */
  @Column('jsonb', { nullable: true })
  htsSnapshotIds: Record<string, string> | null;

  @Column('jsonb', { nullable: true })
  taxRuleSnapshotIds: string[] | null;

  @Column('jsonb', { nullable: true })
  feeRuleSnapshotIds: string[] | null;

  @Column('jsonb', { nullable: true })
  lowValueRuleSnapshotIds: string[] | null;

  @Column('uuid', { nullable: true })
  exchangeRateSnapshotId: string | null;

  @Column('jsonb', { nullable: true })
  formulaIds: string[] | null;

  @Column('decimal', { precision: 3, scale: 2, nullable: true })
  confidence: number | null;

  @Column('timestamptz')
  expiresAt: Date;

  @Column('jsonb', { nullable: true })
  totals: Record<string, number> | null;

  @Column('timestamptz', { nullable: true })
  confirmedAt: Date | null;

  @Column('varchar', { length: 128, nullable: true })
  requestFingerprint: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
