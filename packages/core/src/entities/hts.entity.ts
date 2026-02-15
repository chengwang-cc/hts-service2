import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * HTS Entity - Harmonized Tariff Schedule entries
 * Stores complete HTS classification codes with rates and formulas
 */
@Entity('hts')
@Index(['htsNumber', 'version'], { unique: true })
@Index(['chapter'])
@Index(['heading'])
@Index(['parentHtsNumber'])
export class HtsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * HTS Number - Full classification code (e.g., "0101.21.00.00", "9903.88.03")
   */
  @Column('varchar', { length: 20 })
  htsNumber: string;

  /**
   * HTS Version - e.g., "2025_revision_5"
   */
  @Column('varchar', { length: 50 })
  version: string;

  /**
   * Indent level - Hierarchy depth in HTS structure (0 = Chapter, 1 = Heading, etc.)
   */
  @Column('integer', { default: 0 })
  indent: number;

  /**
   * Description - Product description from USITC
   */
  @Column('text')
  description: string;

  /**
   * Unit of Quantity - e.g., "kg", "doz", "No."
   */
  @Column('varchar', { length: 50, nullable: true })
  unitOfQuantity: string | null;

  /**
   * Unit (raw) - Stored to align with 1243 schema
   */
  @Column('varchar', { length: 50, nullable: true })
  unit: string | null;

  /**
   * General Rate (NTR/MFN) - String representation (e.g., "5%", "$2.50/kg")
   */
  @Column('varchar', { length: 255, nullable: true })
  generalRate: string | null;

  /**
   * General (raw) - Stored to align with 1243 schema
   */
  @Column('varchar', { length: 255, nullable: true })
  general: string | null;

  /**
   * General Rate Formula - Computed formula for calculation
   */
  @Column('text', { nullable: true })
  rateFormula: string | null;

  /**
   * Rate Variables - Variables used in rateFormula
   */
  @Column('jsonb', { nullable: true })
  rateVariables:
    | Array<{
        name: string;
        type: string;
        description?: string;
        unit?: string;
      }>
    | null;

  /**
   * Is Formula Generated - Indicates AI generated formula
   */
  @Column('boolean', { default: false })
  isFormulaGenerated: boolean;

  /**
   * Other Rate (Non-NTR) - For countries without Normal Trade Relations
   * Applies to: Cuba (CU), North Korea (KP), Belarus (BY), Russia (RU)
   */
  @Column('varchar', { length: 255, nullable: true })
  otherRate: string | null;

  /**
   * Other (raw) - Stored to align with 1243 schema
   */
  @Column('varchar', { length: 255, nullable: true })
  other: string | null;

  /**
   * Other Rate Formula - Computed formula for non-NTR calculation
   */
  @Column('text', { nullable: true })
  otherRateFormula: string | null;

  @Column('jsonb', { nullable: true })
  otherRateVariables:
    | Array<{
        name: string;
        type: string;
        description?: string;
        unit?: string;
      }>
    | null;

  @Column('boolean', { default: false })
  isOtherFormulaGenerated: boolean;

  /**
   * Special Rates - Country-specific preferential rates (JSON)
   * Format: { "CA": "Free", "MX": "Free", "AU": "2.5%" }
   */
  @Column('jsonb', { nullable: true })
  specialRates: Record<string, string> | null;

  /**
   * Special (raw) - Stored to align with 1243 schema
   */
  @Column('varchar', { length: 255, nullable: true })
  special: string | null;

  /**
   * Chapter 99 Adjusted Rate - Additional tariffs (e.g., China tariffs)
   */
  @Column('varchar', { length: 255, nullable: true })
  chapter99: string | null;

  /**
   * Chapter 99 linked headings discovered from endnotes/footnotes
   * Example: ["9903.88.15"]
   */
  @Column('jsonb', { nullable: true })
  chapter99Links: string[] | null;

  /**
   * ISO country codes where Chapter 99 adjusted formula applies
   * Example: ["CN"]
   */
  @Column('jsonb', { nullable: true })
  chapter99ApplicableCountries: string[] | null;

  /**
   * ISO country codes treated as non-NTR (Column 2)
   * Defaults are managed in service logic: CU, KP, RU, BY.
   */
  @Column('jsonb', { nullable: true })
  nonNtrApplicableCountries: string[] | null;

  /**
   * Chapter 99 Adjusted Formula - Formula for additional tariffs
   */
  @Column('text', { nullable: true })
  adjustedFormula: string | null;

  @Column('jsonb', { nullable: true })
  adjustedFormulaVariables:
    | Array<{
        name: string;
        type: string;
        description?: string;
        unit?: string;
      }>
    | null;

  @Column('boolean', { default: false })
  isAdjustedFormulaGenerated: boolean;

  /**
   * Other Chapter 99 - Alternative Chapter 99 rate
   */
  @Column('varchar', { length: 255, nullable: true })
  otherChapter99: string | null;

  /**
   * Other Chapter 99 (structured)
   */
  @Column('jsonb', { nullable: true })
  otherChapter99Detail:
    | {
        formula?: string;
        variables?: Array<{
          name: string;
          type: string;
          description?: string;
          unit?: string;
        }>;
        countries?: string[];
      }
    | null;

  /**
   * Footnotes - HTS footnote references (e.g., "See note 1(a)")
   */
  @Column('text', { nullable: true })
  footnotes: string | null;

  /**
   * Additional Duties - Extra duties text (FIXED TYPO: was 'addiitionalDuties')
   */
  @Column('text', { nullable: true })
  additionalDuties: string | null;

  /**
   * Quota fields (if applicable)
   */
  @Column('varchar', { length: 255, nullable: true })
  quota: string | null;

  @Column('varchar', { length: 255, nullable: true })
  quota2: string | null;

  /**
   * Chapter - 2-digit chapter number (e.g., "01", "99")
   */
  @Column('varchar', { length: 2 })
  chapter: string;

  /**
   * Heading - 4-digit heading (e.g., "0101")
   */
  @Column('varchar', { length: 4, nullable: true })
  heading: string | null;

  /**
   * Subheading - 6-digit subheading (e.g., "010121")
   */
  @Column('varchar', { length: 6, nullable: true })
  subheading: string | null;

  /**
   * Statistical Suffix - 8 or 10 digit code (e.g., "01012100")
   */
  @Column('varchar', { length: 10, nullable: true })
  statisticalSuffix: string | null;

  /**
   * Parent HTS Number - Reference to parent in hierarchy
   */
  @Column('varchar', { length: 20, nullable: true })
  parentHtsNumber: string | null;

  /**
   * Parent HTS list (ancestor codes)
   */
  @Column('jsonb', { nullable: true })
  parentHtses: string[] | null;

  /**
   * Full description list (ancestor descriptions)
   */
  @Column('jsonb', { nullable: true })
  fullDescription: string[] | null;

  /**
   * Is Heading - True if this is a heading-level entry
   */
  @Column('boolean', { default: false })
  isHeading: boolean;

  /**
   * Is Subheading - True if this is a subheading-level entry
   */
  @Column('boolean', { default: false })
  isSubheading: boolean;

  /**
   * Has Children - True if this entry has child entries
   */
  @Column('boolean', { default: false })
  hasChildren: boolean;

  /**
   * Source Version - USITC data version (e.g., "2025_revision_1")
   */
  @Column('varchar', { length: 50, nullable: true })
  sourceVersion: string | null;

  /**
   * Import Date - When this entry was imported
   */
  @Column('timestamp', { nullable: true })
  importDate: Date | null;

  /**
   * Is Active - Whether this entry is currently active
   */
  @Column('boolean', { default: true })
  isActive: boolean;

  /**
   * Manual override tracking
   */
  @Column('boolean', { default: false })
  confirmed: boolean;

  @Column('text', { nullable: true })
  updateFormulaComment: string | null;

  @Column('boolean', { default: false })
  requiredReview: boolean;

  @Column('text', { nullable: true })
  requiredReviewComment: string | null;

  /**
   * Effective Date - When this entry became effective
   */
  @Column('date', { nullable: true })
  effectiveDate: Date | null;

  /**
   * Expiration Date - When this entry expires (for temporary entries)
   */
  @Column('date', { nullable: true })
  expirationDate: Date | null;

  /**
   * Metadata - Additional metadata (JSON)
   * Can store: formula confidence, AI-generated flags, etc.
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
