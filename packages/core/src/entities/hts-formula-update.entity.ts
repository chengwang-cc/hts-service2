import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * HTS Formula Update Entity - Manual formula overrides
 * Aligns with 1243 formula generation design.
 */
@Entity('hts_formula_updates')
@Index(['htsNumber', 'countryCode', 'formulaType'], { unique: true })
export class HtsFormulaUpdateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * HTS Number - Reference to HTS entry
   */
  @Column('varchar', { length: 20 })
  htsNumber: string;

  /**
   * Country Code - ISO 3166-1 alpha-2 (e.g., "CN", "MX", "ALL")
   */
  @Column('varchar', { length: 4, default: 'ALL' })
  countryCode: string;

  /**
   * Formula Type - GENERAL | OTHER | ADJUSTED | OTHER_CHAPTER99
   */
  @Column('varchar', { length: 30 })
  formulaType: string;

  /**
   * Override Formula - Manually corrected formula
   */
  @Column('text')
  formula: string;

  /**
   * Formula Variables - Describes variables used by formula
   */
  @Column('jsonb', { nullable: true })
  formulaVariables:
    | Array<{
        name: string;
        type: string;
        description?: string;
        unit?: string;
      }>
    | null;

  /**
   * Comment - Reason for override
   */
  @Column('text', { nullable: true })
  comment: string | null;

  /**
   * Active - Enable/disable override
   */
  @Column('boolean', { default: true })
  active: boolean;

  /**
   * Carryover - Apply to future versions
   */
  @Column('boolean', { default: true })
  carryover: boolean;

  /**
   * Override Extra Tax - Skip extra tax calculation
   */
  @Column('boolean', { default: false })
  overrideExtraTax: boolean;

  /**
   * Update Version - HTS version this applies to
   */
  @Column('varchar', { length: 50 })
  updateVersion: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}
