import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { KnowledgeSourceEntity } from './knowledge-source.entity';

/**
 * Durable per-source item ledger for RSS entries, announcements, and direct
 * source URLs. This prevents repeated fetch churn and gives operators a clear
 * audit trail for what the crawler discovered, ingested, skipped, or failed.
 */
@Entity('knowledge_source_items')
@Index('UQ_knowledge_source_items_source_url', ['sourceId', 'url'], { unique: true })
@Index(['sourceId', 'status'])
@Index(['contentHash'])
@Index(['publishedAt'])
@Index(['lastSeenAt'])
export class KnowledgeSourceItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  sourceId: string;

  @Column('text')
  url: string;

  @Column('text', { nullable: true })
  title: string | null;

  @Column('timestamptz', { nullable: true })
  publishedAt: Date | null;

  @Column('varchar', { length: 24, default: 'discovered' })
  status:
    | 'discovered'
    | 'queued'
    | 'ingested'
    | 'skipped'
    | 'error'
    | string;

  @Column('uuid', { nullable: true })
  knowledgeCardId: string | null;

  @Column('varchar', { length: 64, nullable: true })
  contentHash: string | null;

  @Column('timestamptz', { nullable: true })
  firstSeenAt: Date | null;

  @Column('timestamptz', { nullable: true })
  lastSeenAt: Date | null;

  @Column('timestamptz', { nullable: true })
  lastIngestedAt: Date | null;

  @Column('text', { nullable: true })
  errorMessage: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => KnowledgeSourceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_id' })
  source?: KnowledgeSourceEntity;
}
