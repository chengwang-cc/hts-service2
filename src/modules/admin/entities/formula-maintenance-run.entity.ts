import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('formula_maintenance_runs')
@Index(['status', 'createdAt'])
@Index(['sourceType', 'importId'])
export class FormulaMaintenanceRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 64 })
  sourceType: string;

  @Column('uuid', { nullable: true })
  importId: string | null;

  @Column('varchar', { length: 32, default: 'running' })
  status: string;

  @Column('boolean', { default: false })
  aiEnabled: boolean;

  @Column('integer', { default: 0 })
  itemsScanned: number;

  @Column('integer', { default: 0 })
  trivialCount: number;

  @Column('integer', { default: 0 })
  mechanicalCount: number;

  @Column('integer', { default: 0 })
  structuralCount: number;

  @Column('integer', { default: 0 })
  parserGapCount: number;

  @Column('integer', { default: 0 })
  pendingEvidenceCreated: number;

  @Column('jsonb', { nullable: true })
  summary: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @Column('timestamptz', { nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
