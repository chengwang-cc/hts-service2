import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * KnowledgeCardEntity (Phase 8, P8.T7).
 *
 * A KnowledgeCard is a citable unit of source material backing an
 * ExceptionRule. Each rule's `knowledgeCardKeys: string[]` references
 * rows in this table by `cardKey` (e.g. `cbp.csms.55424218`,
 * `fr.proclamation.10895`, `eu.regulation.2023-956`).
 *
 * This table is intentionally separate from `hts_documents` (which
 * stores HTS-specific PDFs by year/chapter). Knowledge cards are the
 * cross-cutting citation surface for the exception-rule engine; HTS
 * docs are the source-of-truth for tariff schedules.
 *
 * Status transitions:
 *   - `pending_ingest`  (initial; job not yet run)
 *   - `pending_review`  (a content diff vs. the prior version was detected)
 *   - `active`          (current canonical version)
 *   - `superseded`      (replaced by a newer version with the same cardKey)
 *   - `error`           (ingestion failed; see errorMessage)
 *
 * On upsert (same cardKey, different contentHash), the existing row is
 * marked `superseded` and a NEW row is inserted with `pending_review`.
 * The `RuleReviewAlertService` then opens alerts for every rule whose
 * `knowledgeCardKeys` includes this cardKey.
 */
@Entity('knowledge_cards')
@Index(['cardKey'])
@Index(['cardKey', 'status'])
@Index(['contentHash'])
@Index(['status'])
export class KnowledgeCardEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Stable citation key — `{publisher}.{type}.{identifier}`. Examples:
   *   `cbp.csms.55424218`, `fr.proclamation.10895`,
   *   `usitc.note.9903-85`, `eu.regulation.2023-956`
   *
   * Multiple rows can share a cardKey across history; the `status`
   * column distinguishes which is current.
   */
  @Column('varchar', { length: 200 })
  cardKey: string;

  /** 'csms' | 'proclamation' | 'fr-notice' | 'eu-regulation' | 'usitc-note' | 'tariff-schedule' | 'other'. */
  @Column('varchar', { length: 50 })
  documentType: string;

  /** Issuing jurisdiction (ISO-2 or 'EU' / 'INTL'). */
  @Column('varchar', { length: 8, nullable: true })
  jurisdiction: string | null;

  /** Original source URL (if ingested from a URL). */
  @Column('text', { nullable: true })
  sourceUrl: string | null;

  /** SHA-256 of the source text (post-extraction, pre-chunking). */
  @Column('varchar', { length: 64 })
  contentHash: string;

  /** Optional bytes-on-disk reference (e.g. MinIO object path). */
  @Column('text', { nullable: true })
  storageRef: string | null;

  /**
   * Free-form payload — extracted text, parsed structure, classifier
   * outputs, chunk lineage. JSONB to keep the schema additive.
   */
  @Column('jsonb')
  payload: Record<string, unknown>;

  @Column('varchar', { length: 32, default: 'pending_ingest' })
  status: string;

  @Column('text', { nullable: true })
  errorMessage: string | null;

  /** Statutory effective date if surfaced by the classifier. */
  @Column('timestamptz', { nullable: true })
  effectiveDate: Date | null;

  /** Statutory expiration date if surfaced by the classifier. */
  @Column('timestamptz', { nullable: true })
  expirationDate: Date | null;

  /**
   * Legacy 1024-dim embedding column (was BGE-M3 via DGX).
   * Dead data after the 2026-05-27 DGX retirement — no new writes; an
   * eventual migration will drop this column.
   */
  @Column({ type: 'vector', length: 1024, nullable: true })
  embedding: number[] | null;

  /** Active embedding column — OpenAI text-embedding-3-small, 1536-dim. */
  @Column({ type: 'vector', length: 1536, nullable: true, name: 'embedding_openai' })
  embeddingOpenai: number[] | null;

  /** Who/what initiated this ingest. */
  @Column('varchar', { length: 200, default: 'system' })
  ingestedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
