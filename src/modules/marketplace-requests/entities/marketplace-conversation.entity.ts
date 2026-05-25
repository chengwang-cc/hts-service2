import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('marketplace_conversations')
@Index(['requestId'])
@Index(['businessOrganizationId'])
@Index(['brokerOrganizationId'])
@Index(['requestId', 'brokerOrganizationId'], { unique: true })
export class MarketplaceConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  requestId: string;

  @Column('uuid')
  businessOrganizationId: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  brokerProfileId: string;

  @Column('varchar', { length: 40, default: 'active' })
  status: 'active' | 'closed';

  @Column('boolean', { default: false })
  fullPacketConsented: boolean;

  @Column('uuid', { nullable: true })
  fullPacketConsentedByUserId: string | null;

  @Column('timestamp', { nullable: true })
  fullPacketConsentedAt: Date | null;

  /**
   * R1-D-04 — every consent toggle (grant or revoke) appends an entry here
   * so the conversation timeline can show the history without scanning the
   * audit log. Newest entry is the current state.
   */
  @Column('jsonb', { default: [] })
  consentHistory: Array<{
    consent: boolean;
    at: string;
    byUserId: string;
  }>;

  @Column('timestamp', { nullable: true })
  lastMessageAt: Date | null;

  /**
   * Per-participant lastRead cursors used by R1-A-03 unread badges. Either
   * side can advance their own cursor via POST /conversations/:id/read.
   */
  @Column('timestamp', { nullable: true })
  businessLastReadAt: Date | null;

  @Column('timestamp', { nullable: true })
  brokerLastReadAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
