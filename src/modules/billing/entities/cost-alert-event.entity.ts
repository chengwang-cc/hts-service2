import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Audit log of cost-threshold alert firings.
 *
 * One row written by the rollup worker when an org's monthly cost
 * crosses its configured threshold. The in-app banner reads
 * "is there an unacknowledged event for this org for the current
 * period?" rather than re-deriving alert state from raw usage on
 * every page load — the event row IS the source of truth.
 */
@Entity('cost_alert_events')
@Index(['organizationId', 'period'])
@Index(['acknowledgedAt'])
export class CostAlertEventEntity {
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

  @Column('decimal', {
    name: 'observed_cost_usd',
    precision: 14,
    scale: 6,
  })
  observedCostUsd: string;

  @Column('date')
  period: string;

  @Column('jsonb', {
    name: 'channels_delivered',
    default: () => `'[]'::jsonb`,
  })
  channelsDelivered: Array<{ channel: 'in_app' | 'webhook'; deliveredAt: string; ok: boolean; error?: string }>;

  @Column('timestamp', { name: 'acknowledged_at', nullable: true })
  acknowledgedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
