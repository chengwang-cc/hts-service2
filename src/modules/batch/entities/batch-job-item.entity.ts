import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BatchJobEntity } from './batch-job.entity';

export type BatchJobItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

@Entity('batch_job_item')
@Index(['jobId'])
@Index(['jobId', 'rowIndex'])
@Index(['jobId', 'status'])
@Index(['status'])
export class BatchJobItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  jobId: string;

  @ManyToOne(() => BatchJobEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job: BatchJobEntity;

  @Column('int')
  rowIndex: number;

  @Column('varchar', { length: 255, nullable: true })
  referenceId: string | null;

  @Column('text')
  query: string;

  @Column('varchar', { length: 20, default: 'pending' })
  status: BatchJobItemStatus;

  @Column('varchar', { length: 20, nullable: true })
  htsNumber: string | null;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('jsonb', { nullable: true })
  fullDescription: string[] | null;

  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  confidence: number | null;

  @Column('jsonb', { nullable: true })
  topResults: unknown[] | null;

  @Column('jsonb', { nullable: true })
  phases: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  errorMessage: string | null;

  @Column('int', { nullable: true })
  processingMs: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column('timestamptz', { nullable: true })
  completedAt: Date | null;
}
