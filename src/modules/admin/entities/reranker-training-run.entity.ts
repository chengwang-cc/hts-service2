import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Tracks each automated reranker retraining run (Phase 6).
 *
 * Statuses:
 *   pending    → job created, not yet started
 *   skipped    → not enough new feedback; run aborted early
 *   running    → exporting data / uploading to DGX
 *   training   → Python training script running on DGX
 *   restarting → Docker container restart in progress
 *   completed  → new model live, health check passed
 *   failed     → error at any step; see errorMessage
 */
@Entity('reranker_training_runs')
@Index(['status', 'startedAt'])
export class RerankerTrainingRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 20, default: 'pending' })
  status: string;

  /** How many feedback correction pairs were added on top of the base HTS pairs */
  @Column('int', { default: 0 })
  feedbackPairsAdded: number;

  /** Total training pairs exported (base + feedback) */
  @Column('int', { default: 0 })
  totalPairs: number;

  /** Human-readable description of what triggered this run */
  @Column('varchar', { length: 100, nullable: true })
  triggeredBy: string | null;

  /** Error description if status=failed */
  @Column('text', { nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  startedAt: Date;

  @Column('timestamp', { nullable: true })
  completedAt: Date | null;
}
