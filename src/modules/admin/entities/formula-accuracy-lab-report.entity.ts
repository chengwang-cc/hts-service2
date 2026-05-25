import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('formula_accuracy_lab_reports')
@Index(['reportDate', 'status'])
@Index(['createdAt'])
export class FormulaAccuracyLabReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('date')
  reportDate: string;

  @Column('date')
  windowStart: string;

  @Column('date')
  windowEnd: string;

  @Column('integer', { default: 7 })
  windowDays: number;

  @Column('varchar', { length: 32, default: 'generated' })
  status: string;

  @Column('jsonb')
  summary: Record<string, unknown>;

  @Column('jsonb')
  evidenceCoverage: Record<string, unknown>;

  @Column('jsonb')
  cardCoverage: Record<string, unknown>;

  @Column('jsonb')
  shadowComparisons: Record<string, unknown>;

  @Column('jsonb')
  providerOracle: Record<string, unknown>;

  @Column('jsonb')
  brokerGoldenSet: Record<string, unknown>;

  @Column('jsonb')
  policyChangeLatency: Record<string, unknown>;

  @Column('jsonb')
  countryReadiness: Record<string, unknown>;

  @Column('jsonb')
  recommendations: Array<Record<string, unknown>>;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
