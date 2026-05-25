import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_export_jobs')
@Index(['organizationId'])
@Index(['entryId'])
@Index(['adapterId'])
@Index(['status'])
@Index(['createdAt'])
export class BrokerExportJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  entryId: string;

  @Column('uuid')
  adapterId: string;

  @Column('varchar', { length: 40 })
  format: 'generic_csv' | 'json_webhook' | 'provider_specific';

  @Column('varchar', { length: 40, default: 'pending' })
  status:
    | 'pending'
    | 'building'
    | 'delivered'
    | 'failed'
    | 'cancelled';

  @Column('varchar', { length: 512, nullable: true })
  artifactStorageKey: string | null;

  @Column('varchar', { length: 120, nullable: true })
  artifactSha256: string | null;

  @Column('int', { nullable: true })
  artifactByteSize: number | null;

  @Column('jsonb', { nullable: true })
  validationManifest: {
    issuesAtExport: number;
    blockersAtExport: number;
    approvedByUserId?: string;
    approvedAt?: string;
    ruleVersions?: string[];
  } | null;

  @Column('jsonb', { nullable: true })
  requestSummary: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  responseSummary: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  errorMessage: string | null;

  @Column('uuid')
  triggeredByUserId: string;

  @Column('timestamp', { nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
