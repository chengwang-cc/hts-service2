import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Pre-aggregated monthly counters per (partner, endpoint, method). Populated
 * by PartnerUsageMonthlyRollupWorker hourly (re-rolls the current calendar
 * month each tick so quota checks see fresh data).
 *
 * Used by EntitlementGuard to enforce subscription-plan monthly quotas
 * (`api.requestsPerMonth`) and optional dollar caps.
 *
 * Sibling of partner_usage_hourly. Hourly is for dashboards (24h–30d
 * resolution); monthly is for billing-period quota checks.
 */
@Entity('partner_usage_monthly')
@Index(['partnerId', 'bucketMonth'])
@Index(['bucketMonth'])
@Index(['partnerId', 'bucketMonth', 'endpoint', 'method'], { unique: true })
export class PartnerUsageMonthlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** First-of-month UTC midnight, e.g. 2026-06-01T00:00:00Z. */
  @Column('date')
  bucketMonth: Date;

  @Column('uuid')
  partnerId: string;

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

  @Column('numeric', { precision: 14, scale: 6, default: 0 })
  costUsd: string; // numeric maps to string in TypeORM to preserve precision

  @Column('bigint', { default: 0 })
  llmInputTokens: string; // bigint maps to string in TypeORM

  @Column('bigint', { default: 0 })
  llmOutputTokens: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
