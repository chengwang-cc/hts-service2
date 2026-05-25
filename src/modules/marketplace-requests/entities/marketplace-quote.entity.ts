import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('marketplace_quotes')
@Index(['requestId'])
@Index(['brokerProfileId'])
@Index(['brokerOrganizationId'])
@Index(['status'])
@Index(['expiresAt'])
export class MarketplaceQuoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  requestId: string;

  @Column('uuid')
  brokerProfileId: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid', { nullable: true })
  matchId: string | null;

  @Column('varchar', { length: 40, default: 'submitted' })
  status:
    | 'draft'
    | 'submitted'
    | 'accepted'
    | 'rejected'
    | 'expired'
    | 'withdrawn';

  @Column('text', { nullable: true })
  serviceScope: string | null;

  @Column('varchar', { length: 40, default: 'flat' })
  feeModel: 'flat' | 'per_entry' | 'per_line' | 'tiered' | 'custom';

  @Column('jsonb', { nullable: true })
  feeBreakdown: Array<{
    label: string;
    amount: number;
    currency: string;
    notes?: string;
  }> | null;

  @Column('numeric', { precision: 18, scale: 2, nullable: true })
  estimatedTotal: string | null;

  @Column('varchar', { length: 10, default: 'USD' })
  currency: string;

  @Column('varchar', { length: 120, nullable: true })
  estimatedTimeline: string | null;

  @Column('jsonb', { default: [] })
  requiredDocuments: string[];

  @Column('text', { nullable: true })
  brokerNotes: string | null;

  @Column('text', { nullable: true })
  brokerQuestions: string | null;

  @Column('timestamp', { nullable: true })
  submittedAt: Date | null;

  @Column('timestamp', { nullable: true })
  expiresAt: Date | null;

  /**
   * R2-B-03 — set when the expiry-warning cron emits the "your quote
   * expires in 24h" notification, so we don't redeliver each tick.
   */
  @Column('timestamp', { nullable: true })
  expiryWarningSentAt: Date | null;

  @Column('timestamp', { nullable: true })
  acceptedAt: Date | null;

  @Column('uuid', { nullable: true })
  acceptedByUserId: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
