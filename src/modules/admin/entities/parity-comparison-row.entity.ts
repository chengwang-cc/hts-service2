import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * ParityComparisonRowEntity
 *
 * One row per (run × HTS × country × valueBand). Captures the full inputs,
 * both engine responses (ai-service legacy + hts-service native), the
 * mismatch classification, and the AI-validation verdict + human triage.
 */
@Entity('parity_comparison_rows')
@Index(['runId'])
@Index(['runId', 'matched'])
@Index(['runId', 'mismatchReason'])
@Index(['runId', 'chapter'])
@Index(['htsNumber', 'countryOfOrigin'])
export class ParityComparisonRowEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  runId: string;

  // ── Input snapshot ─────────────────────────────────────────────────

  @Column('varchar', { length: 20 })
  htsNumber: string;

  @Column('varchar', { length: 2 })
  chapter: string;

  @Column('varchar', { length: 4, nullable: true })
  heading: string | null;

  @Column('varchar', { length: 8 })
  countryOfOrigin: string;

  @Column('decimal', { precision: 15, scale: 4 })
  declaredValue: number;

  @Column('jsonb')
  inputs: Record<string, number>;

  /** 'free' | 'pct' | 'specific' | 'compound' | 'ch99' | 'non_ntr' | 'unknown' */
  @Column('varchar', { length: 32, nullable: true })
  rateClass: string | null;

  // ── ai-service result ──────────────────────────────────────────────

  @Column('decimal', { precision: 12, scale: 4, nullable: true })
  aiTotalDuty: number | null;

  @Column('jsonb', { nullable: true })
  aiFormulas: any[] | null;

  @Column('text', { nullable: true })
  aiBlockReason: string | null;

  @Column('integer', { nullable: true })
  aiResponseTimeMs: number | null;

  // ── hts-service result ─────────────────────────────────────────────

  @Column('decimal', { precision: 12, scale: 4, nullable: true })
  localTotalDuty: number | null;

  @Column('jsonb', { nullable: true })
  localBreakdown: any[] | null;

  @Column('text', { nullable: true })
  localBlockReason: string | null;

  @Column('integer', { nullable: true })
  localResponseTimeMs: number | null;

  // ── Diff ───────────────────────────────────────────────────────────

  /** localTotalDuty - aiTotalDuty (signed) */
  @Column('decimal', { precision: 12, scale: 4, nullable: true })
  delta: number | null;

  @Column('boolean', { default: false })
  matched: boolean;

  /**
   * 'NONE' | 'ROUNDING_DIFFERENCE' |
   * 'KNOWN_AI_BUG_SPECIAL_RATE_COMMENTED' | 'KNOWN_AI_BUG_DUPLICATE_ROW' |
   * 'AI_SERVICE_UNAVAILABLE' |
   * 'LOCAL_BLOCKED_AI_UNBLOCKED' | 'AI_BLOCKED_LOCAL_UNBLOCKED' |
   * 'COMPONENT_COUNT_DIFFERS' | 'COMPONENT_AMOUNT_DIFFERS' |
   * 'UNKNOWN'
   */
  @Column('varchar', { length: 64, default: 'NONE' })
  mismatchReason: string;

  // ── AI validation (filled by parity-ai-validate job) ───────────────

  /** 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' */
  @Column('varchar', { length: 32, default: 'pending' })
  aiValidationStatus: string;

  @Column('text', { nullable: true })
  aiValidationExplanation: string | null;

  /**
   * 'hts_service_correct' | 'ai_service_correct' | 'both_wrong' |
   * 'ambiguous_source' | 'needs_human_review' | 'cost_cap_reached' |
   * pre-classified bucket name when status='skipped'
   */
  @Column('varchar', { length: 64, nullable: true })
  aiValidationVerdict: string | null;

  @Column('decimal', { precision: 3, scale: 2, nullable: true })
  aiValidationConfidence: number | null;

  /**
   * { htsRow, extraTaxRows, chapterNotes, formulaUpdateRows, dbCitations,
   *   evidenceUsed: string[] }
   */
  @Column('jsonb', { nullable: true })
  aiValidationEvidence: Record<string, any> | null;

  // ── Human triage ───────────────────────────────────────────────────

  /** 'untouched' | 'acknowledged' | 'fix_ai' | 'fix_hts' | 'data_fix' | 'wontfix' */
  @Column('varchar', { length: 32, default: 'untouched' })
  reviewStatus: string;

  @Column('varchar', { length: 128, nullable: true })
  reviewedBy: string | null;

  @Column('text', { nullable: true })
  reviewerNote: string | null;

  @Column('timestamptz', { nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
