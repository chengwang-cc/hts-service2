import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('subscriptions')
@Index(['organizationId'])
@Index(['stripeSubscriptionId'], { unique: true })
@Index(['status'])
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  @Column('varchar', { name: 'stripe_subscription_id', length: 255 })
  stripeSubscriptionId: string;

  @Column('varchar', { name: 'stripe_customer_id', length: 255 })
  stripeCustomerId: string;

  @Column('varchar', { length: 50 })
  plan: string; // FREE, STARTER, PROFESSIONAL, ENTERPRISE

  @Column('varchar', { length: 50 })
  status: string; // active, past_due, canceled, unpaid, trialing

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column('varchar', { length: 3 })
  currency: string; // USD, EUR, etc.

  @Column('varchar', { length: 20 })
  interval: 'month' | 'year';

  @Column('timestamp', { name: 'current_period_start', nullable: true })
  currentPeriodStart: Date | null;

  @Column('timestamp', { name: 'current_period_end', nullable: true })
  currentPeriodEnd: Date | null;

  @Column('timestamp', { name: 'cancel_at', nullable: true })
  cancelAt: Date | null;

  @Column('boolean', { name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd: boolean;

  @Column('timestamp', { name: 'trial_end', nullable: true })
  trialEnd: Date | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
