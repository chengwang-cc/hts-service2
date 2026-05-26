import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * RuleReviewAlertEntity (Phase 8, P8.T9).
 *
 * Opened when a knowledge card a rule cites changes content. One row
 * per (ruleId, cardKey, newHash) — `(ruleId, newHash)` is the natural
 * idempotency key.
 *
 * Status:
 *   - `open` — needs operator triage
 *   - `dismissed` — operator decided no change needed (e.g., editorial)
 *   - `actioned` — rule was updated in code (PR linked)
 */
@Entity('rule_review_alerts')
@Index(['ruleId', 'status'])
@Index(['cardKey'])
@Index(['status', 'createdAt'])
export class RuleReviewAlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ExceptionRule.id (e.g. `us.section232.aluminum-smelt-cast`). */
  @Column('varchar', { length: 200 })
  ruleId: string;

  /** KnowledgeCard.cardKey that changed. */
  @Column('varchar', { length: 200 })
  cardKey: string;

  /** Content hash of the prior card version (null on first ingest). */
  @Column('varchar', { length: 64, nullable: true })
  previousHash: string | null;

  /** Content hash of the new card version. */
  @Column('varchar', { length: 64 })
  newHash: string;

  /** Short human-readable diff summary the operator sees in the digest. */
  @Column('text', { nullable: true })
  diffSummary: string | null;

  /**
   * Optional AI-council advisory (Phase 8.13). Disabled by default;
   * when enabled, contains an LLM's read on what fields of the rule
   * might be affected by the change. NEVER auto-applied.
   */
  @Column('jsonb', { nullable: true })
  aiAdvisoryJson: Record<string, unknown> | null;

  @Column('varchar', { length: 16, default: 'open' })
  status: 'open' | 'dismissed' | 'actioned' | string;

  /** ID of the operator who resolved. */
  @Column('varchar', { length: 200, nullable: true })
  resolvedBy: string | null;

  /** Free-text explanation of resolution. */
  @Column('text', { nullable: true })
  resolutionNote: string | null;

  /** Optional GitHub / PR URL linked to the resolution. */
  @Column('text', { nullable: true })
  resolutionPrUrl: string | null;

  @Column('timestamptz', { nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
