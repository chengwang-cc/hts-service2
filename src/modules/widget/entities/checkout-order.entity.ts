import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

@Entity('checkout_orders')
@Index(['calculationId'])
@Index(['platformOrderId'])
@Index(['organizationId'])
export class CheckoutOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 255 })
  calculationId: string;

  @Column('varchar', { length: 255 })
  platformOrderId: string;

  @Column('varchar', { length: 50 })
  platform: string;

  @Column('varchar', { length: 255, nullable: true })
  storeConnectionId: string | null;

  @Column('uuid')
  organizationId: string;

  @Column('jsonb', { nullable: true })
  calculationSummary: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
