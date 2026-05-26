import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One row per discovered candidate within a discovery run. Captures
 * what was discovered + which (if any) lead it became. Useful for
 * debugging false negatives ("the run said it found 50 but only 30
 * leads exist — what got dropped and why?").
 */
@Entity('broker_outreach_discovery_results')
@Index(['runId', 'createdAt'])
@Index(['runId', 'status'])
@Index(['leadId'])
export class BrokerOutreachDiscoveryResultEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  runId: string;

  @Column('varchar', { length: 24, default: 'ingested' })
  status: 'ingested' | 'updated' | 'skipped' | 'failed' | string;

  @Column('varchar', { length: 255, nullable: true })
  externalId: string | null;

  @Column('varchar', { length: 255, nullable: true })
  companyName: string | null;

  @Column('varchar', { length: 500, nullable: true })
  websiteUrl: string | null;

  @Column('uuid', { nullable: true })
  leadId: string | null;

  @Column('jsonb', { nullable: true })
  payload: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
