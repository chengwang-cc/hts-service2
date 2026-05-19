import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type LookupClassificationJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export type LookupClassificationJobRequestType = 'URL' | 'IMAGE_UPLOAD';

export type LookupClassificationJobSource = 'WEB' | 'SHOPIFY' | 'API';

@Entity('lookup_classification_job')
@Index(['organizationId', 'status'])
@Index(['createdBy', 'status'])
@Index(['status', 'createdAt'])
@Index('IDX_lookup_classification_job_org_source_created_at', [
  'organizationId',
  'source',
  'createdAt',
])
export class LookupClassificationJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('varchar', { length: 255, nullable: true })
  createdBy: string | null;

  @Column('varchar', { length: 20, default: 'pending' })
  status: LookupClassificationJobStatus;

  @Column('varchar', { length: 20 })
  requestType: LookupClassificationJobRequestType;

  @Column('varchar', { length: 20, default: 'WEB' })
  source: LookupClassificationJobSource;

  @Column('varchar', { length: 512, nullable: true })
  productDescription: string | null;

  @Column('varchar', { length: 2048, nullable: true })
  sourceUrl: string | null;

  @Column('varchar', { length: 255, nullable: true })
  imageOriginalFilename: string | null;

  @Column('varchar', { length: 128, nullable: true })
  imageMimeType: string | null;

  @Column('int', { nullable: true })
  imageSizeBytes: number | null;

  @Column('bytea', { nullable: true })
  imageData: Buffer | null;

  @Column('varchar', { length: 128, nullable: true })
  queueJobId: string | null;

  @Column('jsonb', { nullable: true })
  resultJson: Record<string, unknown> | null;

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
