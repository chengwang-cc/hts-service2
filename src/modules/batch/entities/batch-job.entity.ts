import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type BatchJobMethod = 'autocomplete' | 'deep_search';
export type BatchJobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
export type BatchJobSource = 'api' | 'csv';
export type BatchOwnerType = 'guest' | 'user';

@Entity('batch_job')
@Index(['ownerKey'])
@Index(['status'])
@Index(['organizationId'])
@Index(['createdAt'])
export class BatchJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** SHA-256 hash of "guest:<token>" or "user:<userId>" — never stored raw */
  @Column('varchar', { length: 64 })
  ownerKey: string;

  @Column('varchar', { length: 10 })
  ownerType: BatchOwnerType;

  @Column('varchar', { length: 36, nullable: true })
  organizationId: string | null;

  @Column('varchar', { length: 36, nullable: true })
  userId: string | null;

  @Column('varchar', { length: 20 })
  method: BatchJobMethod;

  @Column('varchar', { length: 20, default: 'pending' })
  status: BatchJobStatus;

  @Column('int')
  totalItems: number;

  @Column('int', { default: 0 })
  processedItems: number;

  @Column('int', { default: 0 })
  failedItems: number;

  @Column('varchar', { length: 10 })
  source: BatchJobSource;

  @Column('varchar', { length: 255, nullable: true })
  originalFilename: string | null;

  @Column('text', { nullable: true })
  errorMessage: string | null;

  @Column('timestamptz', { nullable: true })
  startedAt: Date | null;

  @Column('timestamptz', { nullable: true })
  completedAt: Date | null;

  @Column('timestamptz')
  expiresAt: Date;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
