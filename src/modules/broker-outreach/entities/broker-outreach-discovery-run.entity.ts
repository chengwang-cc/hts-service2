import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One row per discovery attempt against an outreach provider (OSM,
 * Google Search scraper, etc). Lets operators audit what was run, by
 * whom, with which input parameters, and the resulting outcome.
 */
@Entity('broker_outreach_discovery_runs')
@Index(['provider', 'createdAt'])
@Index(['status', 'createdAt'])
export class BrokerOutreachDiscoveryRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 32 })
  provider: 'osm' | 'google-search' | string;

  @Column('varchar', { length: 24, default: 'pending' })
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'partial' | string;

  @Column('jsonb')
  input: Record<string, unknown>;

  @Column('integer', { default: 0 })
  fetchedCount: number;

  @Column('integer', { default: 0 })
  insertedCount: number;

  @Column('integer', { default: 0 })
  updatedCount: number;

  @Column('integer', { default: 0 })
  failedCount: number;

  @Column('text', { nullable: true })
  errorMessage: string | null;

  @Column('varchar', { length: 200 })
  triggeredBy: string;

  @Column('varchar', { length: 120, nullable: true })
  jobId: string | null;

  @Column('timestamptz', { nullable: true })
  startedAt: Date | null;

  @Column('timestamptz', { nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
