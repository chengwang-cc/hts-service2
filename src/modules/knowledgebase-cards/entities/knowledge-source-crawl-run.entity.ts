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
 * Crawl execution ledger. A run may target one source or the whole registry.
 */
@Entity('knowledge_source_crawl_runs')
@Index(['sourceId', 'startedAt'])
@Index(['status', 'startedAt'])
@Index(['jobId'])
export class KnowledgeSourceCrawlRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  sourceId: string | null;

  @Column('varchar', { length: 24, default: 'running' })
  status: 'running' | 'succeeded' | 'partial' | 'failed' | string;

  @Column('varchar', { length: 80, nullable: true })
  trigger: string | null;

  @Column('varchar', { length: 120, nullable: true })
  jobId: string | null;

  @Column('int', { default: 0 })
  attemptedItems: number;

  @Column('int', { default: 0 })
  succeededItems: number;

  @Column('int', { default: 0 })
  failedItems: number;

  @Column('jsonb', { nullable: true })
  resultJson: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  startedAt: Date;

  @Column('timestamptz', { nullable: true })
  finishedAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => KnowledgeSourceEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_id' })
  source?: KnowledgeSourceEntity | null;
}
