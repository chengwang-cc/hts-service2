import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * External Provider Formula Snapshot
 * Stores versioned formula snapshots retrieved from external benchmark providers.
 */
@Entity('external_provider_formulas')
@Index('IDX_ext_provider_formula_lookup', [
  'provider',
  'htsNumber',
  'countryCode',
  'entryDate',
])
@Index('IDX_ext_provider_formula_context', ['provider', 'contextHash'])
@Index('IDX_ext_provider_formula_review_status', ['reviewStatus'])
@Index(
  'UQ_ext_provider_formula_latest_context',
  ['provider', 'contextHash', 'isLatest'],
  {
    unique: true,
    where: '"is_latest" = true',
  },
)
export class ExternalProviderFormulaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 32 })
  provider: string;

  @Column('varchar', { length: 20 })
  htsNumber: string;

  @Column('varchar', { length: 3 })
  countryCode: string;

  @Column('date')
  entryDate: string;

  @Column('varchar', { length: 16, default: 'OCEAN' })
  modeOfTransport: string;

  @Column('jsonb')
  inputContext: Record<string, any>;

  @Column('varchar', { length: 64 })
  contextHash: string;

  @Column('text', { nullable: true })
  formulaRaw: string | null;

  @Column('text', { nullable: true })
  formulaNormalized: string | null;

  @Column('jsonb', { nullable: true })
  formulaComponents: Record<string, any> | null;

  @Column('jsonb', { nullable: true })
  outputBreakdown: Record<string, any> | null;

  @Column('varchar', { length: 16, default: 'NETWORK' })
  extractionMethod: string;

  @Column('decimal', { precision: 5, scale: 4, default: 0 })
  extractionConfidence: number;

  @Column('varchar', { length: 32, default: 'v1' })
  parserVersion: string;

  @Column('text')
  sourceUrl: string;

  @Column('jsonb', { nullable: true })
  evidence: Record<string, any> | null;

  /**
   * Review status for admin workflow.
   * PENDING -> APPROVED/REJECTED -> PUBLISHED.
   */
  @Column('varchar', { length: 20, default: 'PENDING' })
  reviewStatus: string;

  /**
   * Optional review decision comment from admin.
   */
  @Column('text', { nullable: true })
  reviewDecisionComment: string | null;

  @Column('varchar', { length: 255, nullable: true })
  reviewedBy: string | null;

  @Column('timestamp', { nullable: true })
  reviewedAt: Date | null;

  /**
   * Published formula update linkage (hts_formula_updates.id).
   */
  @Column('uuid', { nullable: true })
  publishedFormulaUpdateId: string | null;

  @Column('varchar', { length: 255, nullable: true })
  publishedBy: string | null;

  @Column('timestamp', { nullable: true })
  publishedAt: Date | null;

  /**
   * Additional publish metadata (formula type, version, etc.).
   */
  @Column('jsonb', { nullable: true })
  publishMetadata: Record<string, any> | null;

  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  observedAt: Date;

  @Column('varchar', { length: 255, nullable: true })
  observedBy: string | null;

  @Column('boolean', { default: true })
  isLatest: boolean;

  @Column('timestamp', { nullable: true })
  supersededAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
