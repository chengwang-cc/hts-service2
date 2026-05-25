import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('marketplace_requests')
@Index(['requestingOrganizationId'])
@Index(['requestingUserId'])
@Index(['status'])
@Index(['selectedBrokerProfileId'])
@Index(['deadline'])
@Index(['createdAt'])
@Index(['priority'])
export class MarketplaceRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  requestingOrganizationId: string;

  @Column('uuid')
  requestingUserId: string;

  @Column('varchar', { length: 40, default: 'draft' })
  status:
    | 'draft'
    | 'open'
    | 'matched'
    | 'in_quotes'
    | 'broker_selected'
    | 'closed'
    | 'cancelled';

  @Column('varchar', { length: 40, default: 'one_time' })
  requestType: 'one_time' | 'ongoing' | 'project';

  @Column('varchar', { length: 200, nullable: true })
  title: string | null;

  @Column('text', { nullable: true })
  commoditySummary: string | null;

  @Column('varchar', { length: 10, nullable: true })
  originCountry: string | null;

  @Column('varchar', { length: 10, nullable: true })
  destinationCountry: string | null;

  @Column('varchar', { length: 40, nullable: true })
  portOfEntry: string | null;

  @Column('varchar', { length: 40, nullable: true })
  mode:
    | 'ocean'
    | 'air'
    | 'truck'
    | 'rail'
    | 'parcel'
    | 'multimodal'
    | null;

  @Column('jsonb', { default: [] })
  candidateHtsNumbers: string[];

  @Column('jsonb', { default: [] })
  regulatoryFlags: string[];

  @Column('jsonb', { default: [] })
  serviceCategories: string[];

  @Column('numeric', { precision: 18, scale: 2, nullable: true })
  shipmentValue: string | null;

  @Column('varchar', { length: 10, nullable: true })
  shipmentCurrency: string | null;

  @Column('varchar', { length: 60, nullable: true })
  shipmentVolume: string | null;

  @Column('int', { default: 0 })
  readinessScore: number;

  @Column('jsonb', { nullable: true })
  readinessBreakdown: {
    documents?: { score: number; notes?: string };
    classification?: { score: number; notes?: string };
    risk?: { score: number; notes?: string };
  } | null;

  @Column('varchar', { length: 40, default: 'invited' })
  visibilityMode: 'invited' | 'public' | 'private';

  /**
   * R1-B-04 — request priority. 'concierge' indicates the business paid for
   * priority intake; admin queue surfaces these first. Set by the Stripe
   * checkout webhook after payment completes.
   */
  @Column('varchar', { length: 40, default: 'standard' })
  priority: 'standard' | 'concierge';

  @Column('varchar', { length: 120, nullable: true })
  conciergePaymentIntentId: string | null;

  @Column('timestamp', { nullable: true })
  conciergePaidAt: Date | null;

  @Column('timestamp', { nullable: true })
  deadline: Date | null;

  @Column('uuid', { nullable: true })
  selectedBrokerProfileId: string | null;

  @Column('uuid', { nullable: true })
  selectedQuoteId: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
