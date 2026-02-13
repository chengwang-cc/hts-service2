import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * HTS Import History Entity - Tracks USITC data imports
 * Records each import operation for audit and rollback purposes
 */
@Entity('hts_import_history')
@Index(['sourceVersion'])
@Index(['status'])
@Index(['importStartedAt'])
export class HtsImportHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Source Version - USITC data version (e.g., "2025_revision_1")
   */
  @Column('varchar', { length: 50 })
  sourceVersion: string;

  /**
   * Source URL - URL where data was downloaded from
   */
  @Column('text')
  sourceUrl: string;

  /**
   * Source File Hash - SHA-256 hash of downloaded file
   */
  @Column('varchar', { length: 64, nullable: true })
  sourceFileHash: string | null;

  /**
   * Status - Import status
   * Options: PENDING, IN_PROGRESS, COMPLETED, FAILED, ROLLED_BACK
   */
  @Column('varchar', { length: 20, default: 'PENDING' })
  status: string;

  /**
   * Total Entries - Total number of HTS entries in source
   * FIXED BUG: Added @Column decorator (was missing in v1.0)
   */
  @Column('integer', { default: 0 })
  totalEntries: number;

  /**
   * Imported Entries - Number successfully imported
   */
  @Column('integer', { default: 0 })
  importedEntries: number;

  /**
   * Updated Entries - Number of existing entries updated
   */
  @Column('integer', { default: 0 })
  updatedEntries: number;

  /**
   * Skipped Entries - Number skipped (no changes)
   */
  @Column('integer', { default: 0 })
  skippedEntries: number;

  /**
   * Failed Entries - Number that failed to import
   */
  @Column('integer', { default: 0 })
  failedEntries: number;

  /**
   * Import Started At - When import began
   */
  @Column('timestamp', { nullable: true })
  importStartedAt: Date | null;

  /**
   * Import Completed At - When import finished
   */
  @Column('timestamp', { nullable: true })
  importCompletedAt: Date | null;

  /**
   * Duration Seconds - How long import took (seconds)
   */
  @Column('integer', { nullable: true })
  durationSeconds: number | null;

  /**
   * Started By - User or system that initiated import
   */
  @Column('varchar', { length: 255, default: 'SYSTEM' })
  startedBy: string;

  /**
   * Error Message - Error message if import failed
   */
  @Column('text', { nullable: true })
  errorMessage: string | null;

  /**
   * Error Stack - Stack trace for debugging
   */
  @Column('text', { nullable: true })
  errorStack: string | null;

  /**
   * Failed Entries Detail - Details of failed entries (JSON array)
   * Format: [{ htsNumber: "...", error: "..." }]
   */
  @Column('jsonb', { nullable: true })
  failedEntriesDetail: Array<{ htsNumber: string; error: string }> | null;

  /**
   * Import Log - Step-by-step import log
   */
  @Column('jsonb', { nullable: true })
  importLog: string[] | null;

  /**
   * Metadata - Additional import metadata
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  /**
   * Rollback Info - Information about rollback (if rolled back)
   */
  @Column('jsonb', { nullable: true })
  rollbackInfo: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
