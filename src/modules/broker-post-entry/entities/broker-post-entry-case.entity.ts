import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_post_entry_cases')
@Index(['brokerOrganizationId'])
@Index(['entryId'])
@Index(['caseType'])
@Index(['status'])
@Index(['dueAt'])
@Index(['assigneeUserId'])
export class BrokerPostEntryCaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  entryId: string;

  @Column('uuid', { nullable: true })
  clientId: string | null;

  @Column('varchar', { length: 40 })
  caseType:
    | 'cf28'
    | 'cf29'
    | 'psc'
    | 'protest'
    | 'reconciliation'
    | 'drawback'
    | 'classification_review';

  @Column('varchar', { length: 80, nullable: true })
  cbpReference: string | null;

  @Column('varchar', { length: 40, default: 'open' })
  status: 'open' | 'in_progress' | 'awaiting_cbp' | 'resolved' | 'cancelled';

  @Column('text', { nullable: true })
  description: string | null;

  @Column('uuid', { nullable: true })
  assigneeUserId: string | null;

  @Column('timestamp', { nullable: true })
  dueAt: Date | null;

  @Column('timestamp', { nullable: true })
  resolvedAt: Date | null;

  @Column('jsonb', { nullable: true })
  responseAttachments: Array<{
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
