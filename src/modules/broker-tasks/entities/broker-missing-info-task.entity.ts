import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_missing_info_tasks')
@Index(['brokerOrganizationId'])
@Index(['businessOrganizationId'])
@Index(['relationshipId'])
@Index(['entryId'])
@Index(['lineId'])
@Index(['status'])
@Index(['dueAt'])
export class BrokerMissingInfoTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  businessOrganizationId: string;

  @Column('uuid')
  relationshipId: string;

  @Column('uuid', { nullable: true })
  clientId: string | null;

  @Column('uuid', { nullable: true })
  entryId: string | null;

  @Column('uuid', { nullable: true })
  lineId: string | null;

  @Column('uuid', { nullable: true })
  fieldExtractedId: string | null;

  @Column('varchar', { length: 80, nullable: true })
  fieldPath: string | null;

  @Column('varchar', { length: 220 })
  prompt: string;

  @Column('text', { nullable: true })
  detail: string | null;

  @Column('varchar', { length: 40, default: 'open' })
  status:
    | 'open'
    | 'pending_client'
    | 'answered'
    | 'rejected'
    | 'cancelled';

  @Column('varchar', { length: 20, default: 'warning' })
  severity: 'info' | 'warning' | 'blocker';

  @Column('uuid')
  createdByUserId: string;

  @Column('timestamp', { nullable: true })
  dueAt: Date | null;

  @Column('timestamp', { nullable: true })
  notifiedAt: Date | null;

  @Column('timestamp', { nullable: true })
  answeredAt: Date | null;

  @Column('uuid', { nullable: true })
  answeredByUserId: string | null;

  @Column('text', { nullable: true })
  answer: string | null;

  @Column('jsonb', { nullable: true })
  answerAttachments: Array<{
    storageKey: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  }> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
