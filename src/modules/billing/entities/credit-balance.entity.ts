import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Credit Balance Entity
 * Tracks available API credits for each organization
 */
@Entity('credit_balances')
@Index(['organizationId'], { unique: true })
export class CreditBalanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  // Current balance
  @Column('int', { default: 0 })
  balance: number; // Available credits

  @Column('int', { name: 'lifetime_purchased', default: 0 })
  lifetimePurchased: number; // Total credits ever purchased

  @Column('int', { name: 'lifetime_used', default: 0 })
  lifetimeUsed: number; // Total credits ever used

  // Last activity
  @Column('timestamp', { name: 'last_purchase_at', nullable: true })
  lastPurchaseAt: Date | null;

  @Column('timestamp', { name: 'last_used_at', nullable: true })
  lastUsedAt: Date | null;

  /**
   * Pointer to the most recent credit_ledger row applied to this
   * balance (Phase 7, PR F7.1). Drift detection anchor: a periodic
   * audit can verify that the balance equals the sum of ledger
   * deltas up through this id. Set by LedgerService.append after
   * the balance UPDATE; nullable to keep the migration additive.
   */
  @Column('uuid', { name: 'last_ledger_id', nullable: true })
  lastLedgerId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
