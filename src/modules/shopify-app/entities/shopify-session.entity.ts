import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('shopify_sessions')
@Index(['shop'], { unique: true })
@Index(['organizationId'])
export class ShopifySessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 255, unique: true })
  shop: string;

  @Column('text')
  accessToken: string;

  @Column('jsonb')
  scopes: string[];

  @Column('uuid', { nullable: true })
  organizationId: string | null;

  @Column('uuid', { nullable: true })
  connectorId: string | null;

  @Column('varchar', { length: 50, nullable: true })
  nonce: string | null;

  @Column('boolean', { default: true })
  isActive: boolean;

  /**
   * @deprecated Use `calculateDuty` + `displayAtCheckout` instead.
   * Kept for one release as a rollback safety net while the checkout
   * extension is redeployed. Dropped in a follow-up migration once no
   * consumers still read it.
   *
   * Historical values: 'ddu' (default), 'ddp', 'disabled'.
   */
  @Column('varchar', { length: 20, default: 'ddu' })
  dutyDisplayMode: string;

  /**
   * Whether duty/tax should be calculated for this shop's orders.
   * When false, the widget /calculate endpoint short-circuits and the
   * checkout extension renders nothing — no billable API call occurs.
   */
  @Column('boolean', { default: true })
  calculateDuty: boolean;

  /**
   * Whether the calculated duty/tax should be surfaced to the buyer in
   * the checkout extension. Only meaningful when `calculateDuty` is true;
   * the API enforces displayAtCheckout=false if calculateDuty is false.
   */
  @Column('boolean', { default: true })
  displayAtCheckout: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  installedAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
