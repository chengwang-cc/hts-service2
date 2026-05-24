import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * ParityComparisonRunEntity
 *
 * Tracks a single ai-service ↔ hts-service parity sweep. Rows live in
 * `ParityComparisonRowEntity`; this entity is the run-level header carrying
 * counters, summary aggregations, status, and the corpus filter used so
 * runs are reproducible.
 *
 * Status lifecycle:
 *   queued → running → (completed | cancelled | failed)
 */
@Entity('parity_comparison_runs')
@Index(['status'])
@Index(['createdAt'])
@Index(['initiatedBy'])
export class ParityComparisonRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' */
  @Column('varchar', { length: 32, default: 'queued' })
  status: string;

  @Column('varchar', { length: 128 })
  initiatedBy: string;

  /** 'smoke' | 'sample' | 'full' | 'custom' */
  @Column('varchar', { length: 16 })
  scope: string;

  /** Frozen filter spec the corpus selector used: { chapters?, countries?, valueBands? } */
  @Column('jsonb')
  corpusFilter: Record<string, any>;

  @Column('integer', { default: 0 })
  corpusSize: number;

  @Column('integer', { default: 0 })
  rowsProcessed: number;

  @Column('integer', { default: 0 })
  rowsMatched: number;

  @Column('integer', { default: 0 })
  rowsMismatched: number;

  @Column('integer', { default: 0 })
  rowsAiServiceUnavailable: number;

  @Column('varchar', { length: 128, nullable: true })
  aiServiceVersion: string | null;

  @Column('varchar', { length: 128, nullable: true })
  htsServiceVersion: string | null;

  @Column('varchar', { length: 128, nullable: true })
  htsDataVersion: string | null;

  @Column('text', { nullable: true })
  aiServiceUrl: string | null;

  /**
   * { mismatchByReason: {...}, mismatchByChapter: {...}, mismatchByCountry: {...} }
   * Populated when run completes.
   */
  @Column('jsonb', { nullable: true })
  summary: Record<string, any> | null;

  @Column('timestamptz', { nullable: true })
  startedAt: Date | null;

  @Column('timestamptz', { nullable: true })
  completedAt: Date | null;

  @Column('text', { nullable: true })
  cancelReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
