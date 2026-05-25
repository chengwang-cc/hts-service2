import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('broker_status_events')
@Index(['brokerOrganizationId'])
@Index(['businessOrganizationId'])
@Index(['relationshipId'])
@Index(['entryId'])
@Index(['eventType'])
@Index(['createdAt'])
export class BrokerStatusEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  brokerOrganizationId: string | null;

  @Column('uuid', { nullable: true })
  businessOrganizationId: string | null;

  @Column('uuid', { nullable: true })
  relationshipId: string | null;

  @Column('uuid', { nullable: true })
  entryId: string | null;

  @Column('uuid', { nullable: true })
  shipmentId: string | null;

  @Column('varchar', { length: 80 })
  eventType: string;

  @Column('varchar', { length: 220 })
  headline: string;

  @Column('text', { nullable: true })
  detail: string | null;

  @Column('varchar', { length: 20, default: 'info' })
  severity: 'info' | 'warning' | 'error' | 'success';

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
