import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_golden_set_cases')
@Index(['status'])
@Index(['htsNumber', 'originCountry', 'destinationCountry'])
@Index(['brokerName', 'brokerReference'], { unique: true })
@Index(['lastValidatedAt'])
export class BrokerGoldenSetCaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 128 })
  brokerName: string;

  @Column('varchar', { length: 128 })
  brokerReference: string;

  @Column('varchar', { length: 20 })
  htsNumber: string;

  @Column('varchar', { length: 8 })
  originCountry: string;

  @Column('varchar', { length: 8, default: 'US' })
  destinationCountry: string;

  @Column('date')
  entryDate: string;

  @Column('decimal', { precision: 15, scale: 4 })
  declaredValue: number;

  @Column('varchar', { length: 3, default: 'USD' })
  currency: string;

  @Column('jsonb')
  inputs: Record<string, unknown>;

  @Column('decimal', { precision: 15, scale: 4 })
  expectedTotalDuty: number;

  @Column('jsonb')
  expectedComponents: Array<Record<string, unknown>>;

  @Column('jsonb', { nullable: true })
  citations: Array<Record<string, unknown>> | null;

  @Column('varchar', { length: 32, default: 'active' })
  status: string;

  @Column('timestamptz', { nullable: true })
  lastValidatedAt: Date | null;

  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  brokerConfidence: number | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
