import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('invoices')
@Index(['organizationId', 'createdAt'])
@Index(['stripeInvoiceId'], { unique: true })
@Index(['status'])
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  @Column('uuid', { name: 'subscription_id', nullable: true })
  subscriptionId: string | null;

  @Column('varchar', { name: 'stripe_invoice_id', length: 255 })
  stripeInvoiceId: string;

  @Column('varchar', { name: 'stripe_customer_id', length: 255 })
  stripeCustomerId: string;

  @Column('varchar', { name: 'invoice_number', length: 100, nullable: true })
  invoiceNumber: string | null;

  @Column('varchar', { length: 50 })
  status: string; // draft, open, paid, void, uncollectible

  @Column('decimal', { precision: 10, scale: 2 })
  subtotal: number;

  @Column('decimal', { precision: 10, scale: 2 })
  tax: number;

  @Column('decimal', { precision: 10, scale: 2 })
  total: number;

  @Column('varchar', { length: 3 })
  currency: string;

  @Column('timestamp', { name: 'period_start' })
  periodStart: Date;

  @Column('timestamp', { name: 'period_end' })
  periodEnd: Date;

  @Column('timestamp', { name: 'due_date', nullable: true })
  dueDate: Date | null;

  @Column('timestamp', { name: 'paid_at', nullable: true })
  paidAt: Date | null;

  @Column('varchar', {
    name: 'hosted_invoice_url',
    length: 500,
    nullable: true,
  })
  hostedInvoiceUrl: string | null;

  @Column('varchar', { name: 'invoice_pdf', length: 500, nullable: true })
  invoicePdf: string | null;

  @Column('jsonb', { nullable: true })
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    amount: number;
  }> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  // Multi-currency money columns (Phase 7, PR F7.1).
  //
  // `amount_minor_units` mirrors `total` in integer minor units.
  // `tax_amount_minor_units` is pre-populated by Phase 8's Stripe Tax
  // webhook when automatic_tax is on; today it stays nullable so
  // existing invoice rows don't break.
  // `stripe_balance_transaction_id` is the reconciliation join key.
  @Column('bigint', { name: 'amount_minor_units', nullable: true })
  amountMinorUnits: string | null;

  @Column('bigint', { name: 'tax_amount_minor_units', nullable: true })
  taxAmountMinorUnits: string | null;

  @Column('varchar', {
    name: 'stripe_balance_transaction_id',
    length: 64,
    nullable: true,
  })
  stripeBalanceTransactionId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
