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
import { FormulaMaintenanceRunEntity } from './formula-maintenance-run.entity';

@Entity('formula_maintenance_items')
@Index(['runId'])
@Index(['itemType', 'classification'])
@Index(['reviewerStatus'])
@Index(['htsNumber'])
@Index(['stageDiffId'])
export class FormulaMaintenanceItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  runId: string;

  @ManyToOne(() => FormulaMaintenanceRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: FormulaMaintenanceRunEntity;

  @Column('varchar', { length: 48 })
  itemType: string;

  @Column('uuid', { nullable: true })
  stageDiffId: string | null;

  @Column('varchar', { length: 20, nullable: true })
  htsNumber: string | null;

  @Column('varchar', { length: 32 })
  classification: string;

  @Column('varchar', { length: 32 })
  reviewerStatus: string;

  @Column('text')
  reason: string;

  @Column('text')
  suggestedAction: string;

  @Column('uuid', { nullable: true })
  pendingEvidenceId: string | null;

  @Column('jsonb', { nullable: true })
  pendingEvidenceIds: string[] | null;

  @Column('jsonb', { nullable: true })
  deterministicSignals: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  aiRecommendation: Record<string, unknown> | null;

  @Column('varchar', { length: 64, nullable: true })
  aiModel: string | null;

  @Column('varchar', { length: 64, nullable: true })
  aiPromptVersion: string | null;

  @Column('jsonb', { nullable: true })
  generatedTestVectors: Array<Record<string, unknown>> | null;

  @Column('jsonb', { nullable: true })
  counterexamples: Array<Record<string, unknown>> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
