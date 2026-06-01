import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Pre-aggregated hourly counters per (partner, partner_user, endpoint). The
 * scheduled aggregator (PartnerUsageRollupWorker) rolls each closed hour
 * from api_usage_metrics into this table.
 *
 * Dashboards aggregating > 24h SHOULD read from this table. Live queries
 * against api_usage_metrics still work for the trailing 24h (where we
 * accept the cost of COUNT() at this scale).
 */
@Entity('partner_usage_hourly')
@Index(['partnerId', 'bucketHour'])
@Index(['bucketHour'])
@Index(['partnerId', 'partnerUserId', 'bucketHour'])
@Index(['partnerId', 'endpoint', 'bucketHour'])
@Index(['partnerId', 'bucketHour', 'partnerUserId', 'endpoint', 'method'], { unique: true })
export class PartnerUsageHourlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Hour boundary, e.g. 2026-06-01T15:00:00Z. */
  @Column('timestamp')
  bucketHour: Date;

  @Column('uuid')
  partnerId: string;

  /** Nullable: rolls up anonymous (no end-user) requests too. */
  @Column('uuid', { nullable: true })
  partnerUserId: string | null;

  @Column('varchar', { length: 255 })
  endpoint: string;

  @Column('varchar', { length: 10 })
  method: string;

  @Column('integer', { default: 0 })
  requests: number;

  @Column('integer', { default: 0 })
  status2xx: number;

  @Column('integer', { default: 0 })
  status4xx: number;

  @Column('integer', { default: 0 })
  status5xx: number;

  /** p95 of response_time_ms across the bucket. */
  @Column('integer', { nullable: true })
  p95LatencyMs: number | null;

  @Column('bigint', { default: 0 })
  totalResponseTimeMs: string; // bigint maps to string in TypeORM

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
