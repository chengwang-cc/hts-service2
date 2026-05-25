import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BrokerClientEntity } from './broker-client.entity';

@Entity('broker_client_relationships')
@Index(['brokerOrganizationId'])
@Index(['businessOrganizationId'])
@Index(['brokerProfileId'])
@Index(['marketplaceRequestId'])
@Index(['clientId'])
@Index(['status'])
export class BrokerClientRelationshipEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  businessOrganizationId: string;

  @Column('uuid', { nullable: true })
  clientId: string | null;

  @Column('uuid', { nullable: true })
  brokerProfileId: string | null;

  @Column('uuid', { nullable: true })
  marketplaceRequestId: string | null;

  @Column('uuid', { nullable: true })
  marketplaceQuoteId: string | null;

  @Column('varchar', { length: 40, default: 'active' })
  status: 'active' | 'paused' | 'terminated';

  @Column('varchar', { length: 40, default: 'missing' })
  poaStatus: 'missing' | 'pending' | 'verified' | 'expired';

  @Column('timestamp', { nullable: true })
  startedAt: Date | null;

  @Column('timestamp', { nullable: true })
  endedAt: Date | null;

  @Column('jsonb', { nullable: true })
  onboardingChecklist: Array<{
    key: string;
    label: string;
    status: 'pending' | 'completed' | 'skipped';
    completedAt?: string | null;
  }> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => BrokerClientEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'client_id' })
  client?: BrokerClientEntity | null;
}
