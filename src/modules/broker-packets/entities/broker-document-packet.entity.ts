import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_document_packets')
@Index(['brokerOrganizationId'])
@Index(['clientId'])
@Index(['shipmentId'])
@Index(['status'])
@Index(['createdAt'])
export class BrokerDocumentPacketEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  clientId: string;

  @Column('uuid', { nullable: true })
  shipmentId: string | null;

  @Column('uuid', { nullable: true })
  uploadedByUserId: string | null;

  @Column('varchar', { length: 40, default: 'broker' })
  source: 'broker' | 'client_portal' | 'email_ingest' | 'api';

  @Column('varchar', { length: 200, nullable: true })
  label: string | null;

  @Column('varchar', { length: 40, default: 'pending' })
  status:
    | 'pending'
    | 'processing'
    | 'extracted'
    | 'reviewed'
    | 'draft_created'
    | 'failed';

  @Column('timestamp', { nullable: true })
  receivedAt: Date | null;

  @Column('timestamp', { nullable: true })
  processingStartedAt: Date | null;

  @Column('timestamp', { nullable: true })
  processingCompletedAt: Date | null;

  @Column('text', { nullable: true })
  processingError: string | null;

  @Column('jsonb', { nullable: true })
  reconciliation: Array<{
    field: string;
    expected: string;
    actual: string;
    severity: 'blocker' | 'warning' | 'info';
    sourceDocumentIds: string[];
    notes?: string;
  }> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
