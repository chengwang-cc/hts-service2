import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * HTS Formula Candidate Entity
 * Stores AI-generated formula candidates pending review and approval
 */
@Entity('hts_formula_candidates')
@Index(['htsNumber'])
@Index(['status'])
@Index(['confidence'])
@Index(['createdAt'])
export class HtsFormulaCandidateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * HTS Number - Reference to HTS entry
   */
  @Column('varchar', { length: 20 })
  htsNumber: string;

  /**
   * Country Code - ISO 2-letter country code or 'ALL' for general
   */
  @Column('varchar', { length: 3, default: 'ALL' })
  countryCode: string;

  /**
   * Formula Type - Type of formula being proposed
   * Options: GENERAL, OTHER, ADJUSTED, CHAPTER_99
   */
  @Column('varchar', { length: 30 })
  formulaType: string;

  /**
   * Current Formula - Existing formula on HtsEntity (if any)
   */
  @Column('text', { nullable: true })
  currentFormula: string | null;

  /**
   * Proposed Formula - AI-generated formula
   */
  @Column('text')
  proposedFormula: string;

  /**
   * Proposed Variables - Variables used in proposed formula
   * Format: [{ name: "value", type: "number", description: "Declared value", unit: "$" }]
   */
  @Column('jsonb', { nullable: true })
  proposedVariables: Array<{
    name: string;
    type: string;
    description?: string;
    unit?: string;
  }> | null;

  /**
   * Confidence - AI confidence score (0.0000 to 1.0000)
   * Higher values indicate higher confidence in the formula
   */
  @Column('decimal', { precision: 5, scale: 4 })
  confidence: number;

  /**
   * Reasoning - AI explanation for why this formula was generated
   */
  @Column('text')
  reasoning: string;

  /**
   * Status - Candidate review status
   * Options: PENDING, APPROVED, REJECTED
   */
  @Column('varchar', { length: 20, default: 'PENDING' })
  status: string;

  /**
   * Review Comment - Comment from reviewer
   */
  @Column('text', { nullable: true })
  reviewComment: string | null;

  /**
   * Reviewed By - User who reviewed this candidate
   */
  @Column('varchar', { length: 255, nullable: true })
  reviewedBy: string | null;

  /**
   * Reviewed At - When the candidate was reviewed
   */
  @Column('timestamp', { nullable: true })
  reviewedAt: Date | null;

  /**
   * Metadata - Additional metadata (model version, prompt, tokens, etc.)
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  /**
   * P1.8 — original rate text the formula was generated from (e.g.
   * "5%", "$2.50/kg", "See note 1(a)"). Persisted for audit.
   */
  @Column('text', { nullable: true })
  rateText: string | null;

  /**
   * P1.8 — referenced HTS footnote, if any.
   */
  @Column('text', { nullable: true })
  footnoteRef: string | null;

  /**
   * P1.8 — referenced Chapter 99 HTS code, if any.
   */
  @Column('varchar', { length: 20, nullable: true })
  chapter99Ref: string | null;

  /**
   * P1.8 — referenced legal note (e.g. "Section XII Note 2").
   */
  @Column('text', { nullable: true })
  legalNoteRef: string | null;

  /**
   * P1.8 — which parser produced this candidate
   * ('deterministic' | 'llm' | 'hybrid' | 'knowledgebase' | 'manual').
   */
  @Column('varchar', { length: 40, nullable: true })
  parserMethod: string | null;

  /**
   * P1.8 — version tag of the parser implementation.
   */
  @Column('varchar', { length: 40, nullable: true })
  parserVersion: string | null;

  /**
   * P1.8 — link to source_citations row in jurisdiction module.
   */
  @Column('uuid', { nullable: true })
  sourceCitationId: string | null;

  /**
   * P1.7 — chain link when a stale-scan replaces an earlier candidate.
   */
  @Column('uuid', { nullable: true })
  supersededBy: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
