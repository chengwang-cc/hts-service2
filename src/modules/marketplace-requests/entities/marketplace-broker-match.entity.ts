import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('marketplace_broker_matches')
@Index(['requestId'])
@Index(['brokerProfileId'])
@Index(['brokerOrganizationId'])
@Index(['status'])
@Index(['requestId', 'brokerProfileId'], { unique: true })
export class MarketplaceBrokerMatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  requestId: string;

  @Column('uuid')
  brokerProfileId: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('numeric', { precision: 5, scale: 2, default: 0 })
  matchScore: string;

  @Column('jsonb', { nullable: true })
  scoreBreakdown: {
    commodity?: number;
    laneAndMode?: number;
    credentials?: number;
    responsiveness?: number;
    software?: number;
    commercial?: number;
    trustQuality?: number;
  } | null;

  @Column('jsonb', { nullable: true })
  reasons: Array<{
    code: string;
    detail: string;
    verified?: boolean;
  }> | null;

  @Column('jsonb', { nullable: true })
  gaps: string[] | null;

  @Column('varchar', { length: 40, default: 'notified' })
  status:
    | 'invited'
    | 'notified'
    | 'viewed'
    | 'declined'
    | 'quoted'
    | 'shortlisted'
    | 'selected'
    | 'expired';

  @Column('timestamp', { nullable: true })
  viewedAt: Date | null;

  /**
   * R2-B-02 — bumped whenever the RFQ reminder cron emits a notification
   * for an unviewed match, so we don't spam the broker every tick.
   */
  @Column('timestamp', { nullable: true })
  reminderNotifiedAt: Date | null;

  @Column('timestamp', { nullable: true })
  declinedAt: Date | null;

  @Column('text', { nullable: true })
  declineReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
