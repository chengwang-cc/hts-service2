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
import { BrokerOutreachCampaignEntity } from './broker-outreach-campaign.entity';
import { BrokerOutreachLeadEntity } from './broker-outreach-lead.entity';

@Entity('broker_outreach_invites')
@Index(['tokenHash'], { unique: true })
@Index(['leadId', 'status'])
@Index(['campaignId', 'status'])
@Index(['status', 'expiresAt'])
export class BrokerOutreachInviteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  leadId: string;

  @Column('uuid', { nullable: true })
  campaignId: string | null;

  @Column('varchar', { length: 255 })
  email: string;

  @Column('varchar', { length: 64 })
  tokenHash: string;

  @Column('varchar', { length: 24, default: 'created' })
  status:
    | 'created'
    | 'sent'
    | 'opened'
    | 'claimed'
    | 'expired'
    | 'revoked'
    | string;

  @Column('timestamptz')
  expiresAt: Date;

  @Column('timestamptz', { nullable: true })
  sentAt: Date | null;

  @Column('timestamptz', { nullable: true })
  openedAt: Date | null;

  @Column('timestamptz', { nullable: true })
  claimedAt: Date | null;

  @Column('uuid', { nullable: true })
  claimedOrganizationId: string | null;

  @Column('uuid', { nullable: true })
  claimedUserId: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @Column('varchar', { length: 200, default: 'system' })
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => BrokerOutreachLeadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id' })
  lead?: BrokerOutreachLeadEntity;

  @ManyToOne(() => BrokerOutreachCampaignEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: BrokerOutreachCampaignEntity | null;
}
