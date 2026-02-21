import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Auto Top-Up Configuration Entity
 * Stores user preferences for automatic credit recharging
 */
@Entity('auto_topup_configs')
@Index(['organizationId'], { unique: true })
export class AutoTopUpConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  // Top-up settings
  @Column('int', { name: 'trigger_threshold', default: 5 })
  triggerThreshold: number; // Auto-buy when credits drop below this

  @Column('int', { name: 'recharge_amount', default: 20 })
  rechargeAmount: number; // Number of credits to purchase (10, 20, 50, 100, 200)

  // Safety limits
  @Column('decimal', {
    name: 'monthly_spending_cap',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  monthlySpendingCap: number | null; // Max spending per month (optional)

  @Column('decimal', {
    name: 'current_month_spent',
    precision: 10,
    scale: 2,
    default: 0,
  })
  currentMonthSpent: number; // Amount spent this month

  @Column('int', { name: 'current_month', default: 1 })
  currentMonth: number; // Month number (1-12) for tracking

  @Column('int', { name: 'current_year', default: 2026 })
  currentYear: number; // Year for tracking

  // Stripe payment method
  @Column('varchar', {
    name: 'stripe_payment_method_id',
    length: 255,
    nullable: true,
  })
  stripePaymentMethodId: string | null;

  @Column('varchar', {
    name: 'stripe_customer_id',
    length: 255,
    nullable: true,
  })
  stripeCustomerId: string | null;

  // Status
  @Column('boolean', { default: true })
  enabled: boolean;

  @Column('boolean', { name: 'email_notifications', default: true })
  emailNotifications: boolean;

  // Last activity
  @Column('timestamp', { name: 'last_triggered_at', nullable: true })
  lastTriggeredAt: Date | null;

  @Column('int', { name: 'total_auto_purchases', default: 0 })
  totalAutoPurchases: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
