import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('exchange_rate_snapshots')
@Index(['effectiveDate'])
@Index(['effectiveDate', 'source'], { unique: true })
export class ExchangeRateSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('date')
  effectiveDate: string;

  /** 'ecb' | 'fixer' | 'manual' | etc. */
  @Column('varchar', { length: 32, default: 'ecb' })
  source: string;

  /** { 'USD->EUR': 0.92, 'USD->GBP': 0.78, ... } */
  @Column('jsonb')
  rates: Record<string, number>;

  @CreateDateColumn()
  createdAt: Date;
}
