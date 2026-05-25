import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('external_provider_quotes')
@Index(['provider', 'fetchedAt'])
@Index(['htsNumber', 'originCountry', 'destinationCountry'])
@Index(['agreementStatus'])
@Index(['queryHash'], { unique: true })
export class ExternalProviderQuoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 64 })
  provider: string;

  @Column('varchar', { length: 128 })
  queryHash: string;

  @Column('varchar', { length: 20 })
  htsNumber: string;

  @Column('varchar', { length: 8 })
  originCountry: string;

  @Column('varchar', { length: 8, default: 'US' })
  destinationCountry: string;

  @Column('decimal', { precision: 15, scale: 4 })
  declaredValue: number;

  @Column('varchar', { length: 3, default: 'USD' })
  currency: string;

  @Column('date', { nullable: true })
  entryDate: string | null;

  @Column('jsonb')
  query: Record<string, unknown>;

  @Column('decimal', { precision: 15, scale: 4, nullable: true })
  providerTotalDuty: number | null;

  @Column('jsonb', { nullable: true })
  providerComponents: Array<Record<string, unknown>> | null;

  @Column('decimal', { precision: 15, scale: 4, nullable: true })
  localTotalDuty: number | null;

  @Column('jsonb', { nullable: true })
  localComponents: Array<Record<string, unknown>> | null;

  @Column('decimal', { precision: 15, scale: 4, nullable: true })
  delta: number | null;

  @Column('varchar', { length: 32, default: 'pending' })
  agreementStatus: string;

  @Column('text', { nullable: true })
  rawResponseUri: string | null;

  @Column('jsonb', { nullable: true })
  rawResponse: Record<string, unknown> | null;

  @Column('timestamptz', { default: () => 'CURRENT_TIMESTAMP' })
  fetchedAt: Date;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
