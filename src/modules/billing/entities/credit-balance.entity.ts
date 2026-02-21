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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
