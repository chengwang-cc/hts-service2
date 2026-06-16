import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Per-organization cost-threshold alert configuration.
 *
 * One row per org. Partner/business admins set a monthly USD threshold;
 * once monthly cost crosses it the hourly rollup worker writes a row
 * into `cost_alert_events` (the audit log) and delivers via the
 * configured channels.
 *
 * `last_fired_period` is the calendar-month date the alert last fired —
 * the trigger SQL uses it to guarantee at-most-one alert per month per
 * org, even if the rollup runs every hour.
 */
@Entity('cost_alert_configs')
@Index(['organizationId'], { unique: true })
@Index(['enabled'])
export class CostAlertConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  @Column('decimal', {
    name: 'threshold_usd',
    precision: 10,
    scale: 2,
  })
  thresholdUsd: string;

  @Column('boolean', { default: true })
  enabled: boolean;

  @Column('jsonb', { default: () => `'["in_app"]'::jsonb` })
  channels: Array<'in_app' | 'webhook'>;

  @Column('varchar', { name: 'webhook_url', length: 2048, nullable: true })
  webhookUrl: string | null;

  @Column('varchar', { name: 'webhook_secret', length: 64, nullable: true })
  webhookSecret: string | null;

  @Column('timestamp', { name: 'last_fired_at', nullable: true })
  lastFiredAt: Date | null;

  @Column('date', { name: 'last_fired_period', nullable: true })
  lastFiredPeriod: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
