import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { HtsTestCaseEntity } from './hts-test-case.entity';

/**
 * HTS Test Result Entity - Results from running test cases
 * Tracks formula validation test execution and outcomes
 */
@Entity('hts_test_results')
@Index(['testCaseId'])
@Index(['runId'])
@Index(['passed'])
@Index(['executedAt'])
export class HtsTestResultEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Test Case ID - Reference to test case
   */
  @Column('uuid')
  testCaseId: string;

  /**
   * Run ID - Group test results by test run
   * Allows running all tests and tracking as a batch
   */
  @Column('uuid')
  runId: string;

  /**
   * Passed - Whether the test passed
   */
  @Column('boolean')
  passed: boolean;

  /**
   * Actual Output - Actual calculated duty amount
   */
  @Column('decimal', { precision: 15, scale: 4 })
  actualOutput: number;

  /**
   * Expected Output - Expected duty amount (denormalized for reporting)
   */
  @Column('decimal', { precision: 15, scale: 4 })
  expectedOutput: number;

  /**
   * Difference - Absolute difference between actual and expected
   */
  @Column('decimal', { precision: 15, scale: 4 })
  difference: number;

  /**
   * Percentage Error - Error as percentage of expected value
   */
  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  percentageError: number | null;

  /**
   * Formula Used - The actual formula that was executed
   */
  @Column('text')
  formulaUsed: string;

  /**
   * Formula Source - Where the formula came from
   * Options: "knowledgebase", "manual_override", "generated", "ai_generated_realtime"
   */
  @Column('varchar', { length: 50 })
  formulaSource: string;

  /**
   * Execution Time - How long the calculation took (milliseconds)
   */
  @Column('integer', { nullable: true })
  executionTimeMs: number | null;

  /**
   * Error Message - Error message if test failed with exception
   */
  @Column('text', { nullable: true })
  errorMessage: string | null;

  /**
   * Stack Trace - Stack trace for debugging failures
   */
  @Column('text', { nullable: true })
  stackTrace: string | null;

  /**
   * Input Values - Input used for this test (denormalized)
   */
  @Column('jsonb')
  inputValues: Record<string, number>;

  /**
   * Executed At - When this test was run
   */
  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  executedAt: Date;

  /**
   * Engine Version - Version of calculation engine used
   */
  @Column('varchar', { length: 20, nullable: true })
  engineVersion: string | null;

  /**
   * Environment - Test environment (e.g., "test", "staging", "production")
   */
  @Column('varchar', { length: 20, default: 'test' })
  environment: string;

  /**
   * Metadata - Additional test result metadata
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  /**
   * Relation to Test Case (optional - for joins)
   */
  @ManyToOne(() => HtsTestCaseEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'test_case_id' })
  testCase?: HtsTestCaseEntity;
}
