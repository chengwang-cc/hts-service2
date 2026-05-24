import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * LowValueRuleEntity - per-jurisdiction low-value treatment.
 * Examples: GB GBP 135, AU AUD 1,000, NZ NZD 1,000, JP 10,000 JPY,
 * EU IOSS EUR 150, TW NT$2,000.
 */
@Entity('low_value_rules')
@Index(['jurisdictionCode', 'effectiveFrom'])
@Index(['jurisdictionCode'])
export class LowValueRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 8 })
  jurisdictionCode: string;

  @Column('varchar', { length: 8 })
  currency: string;

  @Column('decimal', { precision: 15, scale: 4 })
  threshold: number;

  /** 'exempt' | 'border' | 'simplified' | 'seller_collected' */
  @Column('varchar', { length: 32 })
  dutyTreatment: string;

  /** 'exempt' | 'border' | 'seller_collected_vat' | 'seller_collected_gst' */
  @Column('varchar', { length: 32 })
  taxTreatment: string;

  @Column('boolean', { default: false })
  sellerCollection: boolean;

  /** HS6 prefixes that are EXCLUDED from low-value treatment (e.g., excise) */
  @Column('jsonb', { nullable: true })
  excludedHsPrefixes: string[] | null;

  @Column('date')
  effectiveFrom: string;

  @Column('date', { nullable: true })
  effectiveTo: string | null;

  @Column('uuid', { nullable: true })
  sourceCitationId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
