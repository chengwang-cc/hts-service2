import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * TaxRuleEntity - VAT / GST / consumption tax / business tax rule per
 * jurisdiction (and optional member state).
 */
@Entity('tax_rules')
@Index(['jurisdictionCode'])
@Index(['jurisdictionCode', 'memberStateCode', 'taxType'])
@Index(['effectiveFrom'])
export class TaxRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 8 })
  jurisdictionCode: string;

  @Column('varchar', { length: 8, nullable: true })
  memberStateCode: string | null;

  /** 'VAT' | 'GST' | 'business_tax' | 'consumption_tax' | 'sales_tax' */
  @Column('varchar', { length: 32 })
  taxType: string;

  /** Display name e.g. 'Standard VAT', 'Reduced VAT', '5% Business Tax' */
  @Column('varchar', { length: 128 })
  name: string;

  /** Rate as a decimal fraction (0.19 for 19%) */
  @Column('decimal', { precision: 6, scale: 4 })
  rate: number;

  /** Optional mathjs formula overriding the rate-on-base default. */
  @Column('text', { nullable: true })
  baseFormula: string | null;

  /**
   * W0.5.T5 (2026-05-26): canonical tax-base enum. Lets the FE explain
   * "why was this tax computed on a broader base than the goods value?"
   *   - GOODS_VALUE: rate × declaredValue
   *   - CIF: rate × (declaredValue + shipping + insurance)
   *   - CIF_PLUS_DUTY: rate × (CIF + base customs duty)
   *   - CIF_PLUS_DUTY_PLUS_FEES: rate × (CIF + duty + MPF/HMF/etc.)
   *   - GROSS_UP_INCLUSIVE: tax is included in the price; back out
   *   - COUNTRY_CUSTOM_FORMULA: see `baseFormula` for the explicit formula
   */
  @Column('varchar', { length: 32, default: 'GOODS_VALUE' })
  taxBaseFormula:
    | 'GOODS_VALUE'
    | 'CIF'
    | 'CIF_PLUS_DUTY'
    | 'CIF_PLUS_DUTY_PLUS_FEES'
    | 'GROSS_UP_INCLUSIVE'
    | 'COUNTRY_CUSTOM_FORMULA';

  /** 'checkout' | 'border' | 'reverse_charge' | 'exempt' */
  @Column('varchar', { length: 24 })
  collectionPoint: string;

  @Column('uuid', { nullable: true })
  thresholdId: string | null;

  @Column('jsonb', { nullable: true })
  exemptions: Record<string, any> | null;

  @Column('jsonb', { nullable: true })
  appliesWhen: Record<string, any> | null;

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
