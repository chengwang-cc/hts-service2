import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Credit Purchase Entity
 * Tracks one-time credit purchases for API usage
 */
@Entity('credit_purchases')
@Index(['organizationId', 'status'])
@Index(['stripeSessionId'], { unique: true })
export class CreditPurchaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  // Stripe payment details
  @Column('varchar', { name: 'stripe_session_id', length: 255 })
  stripeSessionId: string;

  @Column('varchar', { name: 'stripe_payment_intent_id', length: 255, nullable: true })
  stripePaymentIntentId: string | null;

  // Credit details
  @Column('int')
  credits: number; // Number of credits purchased

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number; // Amount paid in dollars

  @Column('varchar', { length: 3, default: 'USD' })
  currency: string;

  // Status tracking
  @Column('varchar', { length: 50, default: 'pending' })
  status: string; // pending, completed, failed, refunded

  // Return URL from frontend
  @Column('text', { name: 'return_url' })
  returnUrl: string;

  // Additional metadata
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column('timestamp', { name: 'completed_at', nullable: true })
  completedAt: Date | null;
}
