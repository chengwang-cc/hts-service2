import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * HTS Extra Tax Entity - Additional taxes and fees applied to imports
 * Examples: Merchandise Processing Fee (MPF), Harbor Maintenance Fee (HMF),
 * Section 301 tariffs, IEEPA tariffs, etc.
 */
@Entity('hts_extra_taxes')
@Index(['htsNumber'])
@Index(['taxCode'])
@Index(['isActive'])
export class HtsExtraTaxEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Tax Code - Unique identifier for this tax type
   * Examples: "MPF", "HMF", "SECTION_301", "IEEPA_CN"
   */
  @Column('varchar', { length: 50 })
  taxCode: string;

  /**
   * Tax Name - Display name for this tax
   */
  @Column('varchar', { length: 255 })
  taxName: string;

  /**
   * Description - What this tax is for
   */
  @Column('text', { nullable: true })
  description: string | null;

  /**
   * HTS Number - HTS code this tax applies to
   * Use "*" or null for taxes that apply to all HTS codes
   */
  @Column('varchar', { length: 20, nullable: true })
  htsNumber: string | null;

  /**
   * HTS Chapter - Chapter this tax applies to (if not HTS-specific)
   * Example: "99" for all Chapter 99 entries
   */
  @Column('varchar', { length: 2, nullable: true })
  htsChapter: string | null;

  /**
   * Country Code - Country this tax applies to (or "ALL")
   * Examples: "CN" (China), "RU" (Russia), "ALL"
   */
  @Column('varchar', { length: 3, default: 'ALL' })
  countryCode: string;

  /**
   * Extra Rate Type - How this tax is applied
   * Options: ADD_ON, STANDALONE, CONDITIONAL, POST_CALCULATION
   * Uses varchar with CHECK constraint instead of enum (per CLAUDE.md)
   */
  @Column('varchar', { length: 50, default: 'ADD_ON' })
  extraRateType: string; // ADD_ON | STANDALONE | CONDITIONAL | POST_CALCULATION

  /**
   * Rate Text - Text representation of rate
   * Examples: "0.3464%", "$5.25 per entry", "25% ad valorem"
   */
  @Column('varchar', { length: 255 })
  rateText: string;

  /**
   * Rate Formula - Computed formula for calculation
   */
  @Column('text', { nullable: true })
  rateFormula: string | null;

  /**
   * Minimum Amount - Minimum tax amount (if applicable)
   * Example: MPF minimum is $27.75
   */
  @Column('decimal', { precision: 15, scale: 4, nullable: true })
  minimumAmount: number | null;

  /**
   * Maximum Amount - Maximum tax amount (if applicable)
   * Example: MPF maximum is $579.23
   */
  @Column('decimal', { precision: 15, scale: 4, nullable: true })
  maximumAmount: number | null;

  /**
   * Is Percentage - Whether this is a percentage-based tax
   */
  @Column('boolean', { default: false })
  isPercentage: boolean;

  /**
   * Apply To - What base value this applies to
   * Options: VALUE, DUTY, TOTAL, QUANTITY, WEIGHT
   */
  @Column('varchar', { length: 20, default: 'VALUE' })
  applyTo: string;

  /**
   * Conditions - Conditions for applying this tax (JSON)
   * Example: { "minValue": 2500, "importType": "commercial" }
   */
  @Column('jsonb', { nullable: true })
  conditions: Record<string, any> | null;

  /**
   * Priority - Application order for multiple taxes
   */
  @Column('integer', { default: 50 })
  priority: number;

  /**
   * Is Active - Whether this tax is currently active
   */
  @Column('boolean', { default: true })
  isActive: boolean;

  /**
   * Effective Date - When this tax becomes effective
   */
  @Column('date', { nullable: true })
  effectiveDate: Date | null;

  /**
   * Expiration Date - When this tax expires
   */
  @Column('date', { nullable: true })
  expirationDate: Date | null;

  /**
   * Legal Reference - Legal authority for this tax
   * Example: "19 U.S.C. 58c", "Section 301 Trade Act"
   */
  @Column('text', { nullable: true })
  legalReference: string | null;

  /**
   * Notes - Additional notes about this tax
   */
  @Column('text', { nullable: true })
  notes: string | null;

  /**
   * Metadata - Additional tax metadata
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
