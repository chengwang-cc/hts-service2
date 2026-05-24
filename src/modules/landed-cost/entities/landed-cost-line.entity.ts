import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('landed_cost_lines')
@Index(['quoteId'])
@Index(['quoteId', 'lineNumber'], { unique: true })
export class LandedCostLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  quoteId: string;

  @Column('integer')
  lineNumber: number;

  @Column('varchar', { length: 128, nullable: true })
  sku: string | null;

  @Column('varchar', { length: 20, nullable: true })
  hsCode: string | null;

  @Column('varchar', { length: 20, nullable: true })
  destinationCode: string | null;

  @Column('varchar', { length: 8 })
  countryOfOrigin: string;

  @Column('decimal', { precision: 12, scale: 4 })
  declaredValue: number;

  @Column('decimal', { precision: 12, scale: 4, nullable: true })
  weightKg: number | null;

  @Column('integer', { nullable: true })
  quantity: number | null;

  @Column('decimal', { precision: 12, scale: 4, default: 0 })
  baseDuty: number;

  @Column('decimal', { precision: 12, scale: 4, default: 0 })
  additionalTariffs: number;

  @Column('decimal', { precision: 12, scale: 4, default: 0 })
  fees: number;

  @Column('decimal', { precision: 12, scale: 4, default: 0 })
  taxes: number;

  @Column('decimal', { precision: 12, scale: 4, default: 0 })
  totalDuty: number;

  @Column('decimal', { precision: 12, scale: 4, default: 0 })
  landedCost: number;

  @Column('jsonb', { nullable: true })
  dutyBreakdown: Array<Record<string, any>> | null;

  @Column('jsonb', { nullable: true })
  taxBreakdown: Array<Record<string, any>> | null;

  @Column('jsonb', { nullable: true })
  feeBreakdown: Array<Record<string, any>> | null;

  @Column('jsonb', { nullable: true })
  controls: Array<Record<string, any>> | null;

  @Column('jsonb', { nullable: true })
  warnings: string[] | null;

  @Column('jsonb', { nullable: true })
  sourceCitations: Array<Record<string, any>> | null;

  /** 'provided' | 'catalog' | 'auto' | 'fallback' */
  @Column('varchar', { length: 16, default: 'provided' })
  classificationSource: string;

  @CreateDateColumn()
  createdAt: Date;
}
