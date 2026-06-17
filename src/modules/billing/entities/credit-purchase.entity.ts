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

  @Column('varchar', {
    name: 'stripe_payment_intent_id',
    length: 255,
    nullable: true,
  })
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

  // Multi-currency money columns (Phase 7, PR F7.1).
  //
  // `amount_minor_units` is the canonical monetary representation
  // going forward — integer cents (or smaller-unit equivalent for
  // currencies like JPY). `amount` decimal stays in place for
  // backwards-compat with controllers that haven't migrated yet.
  //
  // `fx_rate_to_functional` converts from the txn currency to USD
  // (today's only functional currency). For USD purchases it's 1.0;
  // for future non-USD currencies it captures the rate at the time of
  // the purchase so historical reports don't drift with FX moves.
  //
  // `amount_functional_minor_units = amount_minor_units * fx_rate`
  // is the USD-equivalent at purchase time, denormalized for cheap
  // SUM() queries.
  //
  // `stripe_balance_transaction_id` is the canonical reconciliation
  // join key. Populated by the payment_intent.succeeded webhook
  // handler from balance_transaction expansion.
  @Column('bigint', { name: 'amount_minor_units', nullable: true })
  amountMinorUnits: string | null;

  @Column('numeric', {
    name: 'fx_rate_to_functional',
    precision: 18,
    scale: 8,
    default: 1.0,
  })
  fxRateToFunctional: string;

  @Column('varchar', { name: 'fx_rate_source', length: 64, nullable: true })
  fxRateSource: string | null;

  @Column('timestamp', { name: 'fx_rate_captured_at', nullable: true })
  fxRateCapturedAt: Date | null;

  @Column('bigint', {
    name: 'amount_functional_minor_units',
    nullable: true,
  })
  amountFunctionalMinorUnits: string | null;

  @Column('varchar', {
    name: 'stripe_balance_transaction_id',
    length: 64,
    nullable: true,
  })
  stripeBalanceTransactionId: string | null;

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
