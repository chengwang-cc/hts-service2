import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * HTS Test Case Entity - Test cases for formula validation
 * Stores known input/output pairs to verify calculation accuracy
 */
@Entity('hts_test_cases')
@Index(['htsNumber'])
@Index(['country'])
export class HtsTestCaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * HTS Number - Reference to HTS entry
   */
  @Column('varchar', { length: 20 })
  htsNumber: string;

  /**
   * Country Code - ISO 2-letter country code
   */
  @Column('varchar', { length: 3, default: 'ALL' })
  country: string;

  /**
   * Test Name - Descriptive name for this test case
   */
  @Column('varchar', { length: 255 })
  testName: string;

  /**
   * Description - What this test case validates
   */
  @Column('text', { nullable: true })
  description: string | null;

  /**
   * Input Values - Input variables for calculation (JSON)
   * Example: { "value": 1000, "weight": 50, "quantity": 100 }
   */
  @Column('jsonb')
  inputValues: Record<string, number>;

  /**
   * Expected Output - Expected duty amount
   */
  @Column('decimal', { precision: 15, scale: 4 })
  expectedOutput: number;

  /**
   * Tolerance - Acceptable margin of error (for floating point comparison)
   */
  @Column('decimal', { precision: 10, scale: 4, default: () => '0.01' })
  tolerance: number;

  /**
   * Rate Type - Type of rate being tested
   * Options: GENERAL, OTHER, CHAPTER_99, SPECIAL
   */
  @Column('varchar', { length: 20, default: 'GENERAL' })
  rateType: string;

  /**
   * Source - Where this test case came from
   * Examples: "MANUAL", "USITC_EXAMPLE", "CUSTOMER_CASE", "REGRESSION"
   */
  @Column('varchar', { length: 50, default: 'MANUAL' })
  source: string;

  /**
   * Is Active - Whether this test case is currently active
   */
  @Column('boolean', { default: true })
  isActive: boolean;

  /**
   * Priority - Test priority (higher = more important)
   */
  @Column('integer', { default: 50 })
  priority: number;

  /**
   * Created By - User who created this test case
   */
  @Column('varchar', { length: 255 })
  createdBy: string;

  /**
   * Notes - Additional notes about this test case
   */
  @Column('text', { nullable: true })
  notes: string | null;

  /**
   * Tags - Test case tags for categorization (JSON array)
   */
  @Column('jsonb', { nullable: true })
  tags: string[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}
