import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_outreach_leads')
@Index(['sourceProvider', 'sourceExternalId'], { unique: true })
@Index(['status', 'createdAt'])
@Index(['country', 'businessCategory'])
@Index(['domain'])
export class BrokerOutreachLeadEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 255 })
  companyName: string;

  @Column('varchar', { length: 32, default: 'manual' })
  sourceProvider: 'manual' | 'osm' | 'google' | 'csv' | 'api' | string;

  @Column('varchar', { length: 255, nullable: true })
  sourceExternalId: string | null;

  @Column('varchar', { length: 120, nullable: true })
  businessCategory: string | null;

  @Column('varchar', { length: 500, nullable: true })
  websiteUrl: string | null;

  @Column('varchar', { length: 255, nullable: true })
  domain: string | null;

  @Column('varchar', { length: 255, nullable: true })
  contactEmail: string | null;

  @Column('varchar', { length: 60, nullable: true })
  contactPhone: string | null;

  @Column('varchar', { length: 80, nullable: true })
  country: string | null;

  @Column('varchar', { length: 120, nullable: true })
  region: string | null;

  @Column('varchar', { length: 120, nullable: true })
  city: string | null;

  @Column('text', { nullable: true })
  address: string | null;

  @Column('numeric', { precision: 10, scale: 7, nullable: true })
  latitude: string | null;

  @Column('numeric', { precision: 10, scale: 7, nullable: true })
  longitude: string | null;

  @Column('varchar', { length: 24, default: 'new' })
  status:
    | 'new'
    | 'reviewed'
    | 'qualified'
    | 'invited'
    | 'converted'
    | 'suppressed'
    | string;

  @Column('numeric', { precision: 5, scale: 2, default: '0' })
  score: string;

  @Column('jsonb', { default: [] })
  tags: string[];

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @Column('timestamptz', { nullable: true })
  lastImportedAt: Date | null;

  @Column('timestamptz', { nullable: true })
  lastContactedAt: Date | null;

  @Column('timestamptz', { nullable: true })
  convertedAt: Date | null;

  @Column('varchar', { length: 200, default: 'system' })
  createdBy: string;

  @Column('varchar', { length: 200, default: 'system' })
  updatedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
