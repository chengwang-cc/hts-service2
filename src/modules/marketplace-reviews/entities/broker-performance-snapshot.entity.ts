import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('broker_performance_snapshots')
@Index(['brokerProfileId'])
@Index(['brokerOrganizationId'])
@Index(['snapshotDate'])
@Index(['brokerProfileId', 'snapshotDate'], { unique: true })
export class BrokerPerformanceSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerProfileId: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('date')
  snapshotDate: string;

  @Column('int', { default: 0 })
  leadsNotified: number;

  @Column('int', { default: 0 })
  leadsViewed: number;

  @Column('int', { default: 0 })
  quotesSubmitted: number;

  @Column('int', { default: 0 })
  quotesAccepted: number;

  @Column('numeric', { precision: 6, scale: 4, nullable: true })
  responseRate: string | null;

  @Column('numeric', { precision: 6, scale: 4, nullable: true })
  quoteRate: string | null;

  @Column('numeric', { precision: 6, scale: 4, nullable: true })
  closeRate: string | null;

  @Column('numeric', { precision: 5, scale: 2, nullable: true })
  averageRating: string | null;

  @Column('int', { default: 0 })
  completedEngagements: number;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
