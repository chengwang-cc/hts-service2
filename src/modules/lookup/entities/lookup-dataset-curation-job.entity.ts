import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type LookupDatasetCurationJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

@Entity('lookup_dataset_curation_job')
@Index(['organizationId', 'status'])
@Index(['createdBy', 'status'])
@Index(['status', 'createdAt'])
export class LookupDatasetCurationJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('varchar', { length: 255, nullable: true })
  createdBy: string | null;

  @Column('varchar', { length: 20, default: 'pending' })
  status: LookupDatasetCurationJobStatus;

  @Column('varchar', { length: 255 })
  originalFilename: string;

  @Column('varchar', { length: 128, nullable: true })
  mimeType: string | null;

  @Column('int', { nullable: true })
  fileSizeBytes: number | null;

  @Column('bytea', { nullable: true })
  sourceCsvData: Buffer | null;

  @Column('jsonb')
  optionsJson: Record<string, unknown>;

  @Column('varchar', { length: 128, nullable: true })
  queueJobId: string | null;

  @Column('jsonb', { nullable: true })
  summaryJson: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  standardizedCsv: string | null;

  @Column('text', { nullable: true })
  rejectedCsv: string | null;

  @Column('text', { nullable: true })
  evalCsv: string | null;

  @Column('text', { nullable: true })
  auditCsv: string | null;

  @Column('jsonb', { nullable: true })
  auditSummaryJson: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  errorMessage: string | null;

  @Column('timestamptz', { nullable: true })
  startedAt: Date | null;

  @Column('timestamptz', { nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
