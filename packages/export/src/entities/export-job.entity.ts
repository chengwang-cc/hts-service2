import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('export_jobs')
@Index(['organizationId', 'createdAt'])
@Index(['status'])
export class ExportJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  @Column('uuid', { name: 'created_by' })
  createdBy: string;

  @Column('varchar', { length: 50 })
  template: string;

  @Column('varchar', { length: 20 })
  format: string;

  @Column('jsonb', { nullable: true })
  filters: {
    dateRange?: { start: Date; end: Date };
    status?: string[];
    htsCodePrefix?: string;
    originCountry?: string[];
  } | null;

  @Column('varchar', { length: 20, default: 'pending' })
  status: 'pending' | 'processing' | 'completed' | 'failed';

  @Column('varchar', { name: 'file_url', nullable: true })
  fileUrl: string | null;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize: number | null;

  @Column({ name: 'record_count', type: 'int', default: 0 })
  recordCount: number;

  @Column({ name: 'processed_records', type: 'int', default: 0 })
  processedRecords: number;

  @Column({ name: 'failed_records', type: 'int', default: 0 })
  failedRecords: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column('timestamp', { name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column('timestamp', { name: 'expires_at', nullable: true })
  expiresAt: Date | null;
}
