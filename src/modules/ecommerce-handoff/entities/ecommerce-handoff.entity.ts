import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ECOM_HANDOFF_STATES } from '../dto/ecommerce-handoff.dto';

@Entity('ecommerce_handoffs')
@Index(['organizationId', 'platform', 'externalOrderId'], { unique: true })
@Index(['organizationId', 'state'])
@Index(['createdAt'])
export class EcommerceHandoffEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('varchar', { length: 32 })
  platform: string;

  @Column('varchar', { length: 120 })
  externalOrderId: string;

  @Column('varchar', { length: 255, nullable: true })
  externalStoreId: string | null;

  @Column('varchar', { length: 32, default: 'broker_review_required' })
  state: (typeof ECOM_HANDOFF_STATES)[number] | string;

  @Column('varchar', { length: 8 })
  originCountry: string;

  @Column('varchar', { length: 8 })
  destinationCountry: string;

  @Column('varchar', { length: 12, nullable: true })
  portOfEntry: string | null;

  @Column('jsonb')
  items: Array<Record<string, unknown>>;

  @Column('numeric', { precision: 14, scale: 2, nullable: true })
  shipmentValue: string | null;

  @Column('varchar', { length: 8, nullable: true })
  shipmentCurrency: string | null;

  @Column('uuid', { nullable: true })
  marketplaceRequestId: string | null;

  @Column('jsonb', { nullable: true })
  writebackStatus: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @Column('varchar', { length: 200, default: 'system' })
  createdBy: string;

  @Column('varchar', { length: 200, default: 'system' })
  updatedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
