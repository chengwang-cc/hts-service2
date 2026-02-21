import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('usage_records')
@Index(['organizationId', 'metricName', 'timestamp'])
@Index(['subscriptionId'])
export class UsageRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  @Column('uuid', { name: 'subscription_id', nullable: true })
  subscriptionId: string | null;

  @Column('varchar', { name: 'metric_name', length: 100 })
  metricName: string; // classifications.monthly, calculations.monthly, etc.

  @Column('int')
  quantity: number;

  @Column('timestamp')
  timestamp: Date;

  @Column('varchar', {
    name: 'stripe_usage_record_id',
    length: 255,
    nullable: true,
  })
  stripeUsageRecordId: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
