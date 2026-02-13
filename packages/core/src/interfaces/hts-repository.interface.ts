import { HtsEntity } from '../entities/hts.entity';

/**
 * HTS Repository Interface
 * Provides abstraction for HTS data access operations
 */
export interface IHtsRepository {
  /**
   * Find HTS entry by exact HTS number
   */
  findByNumber(htsNumber: string): Promise<HtsEntity | null>;

  /**
   * Find HTS entries by chapter
   */
  findByChapter(chapter: string): Promise<HtsEntity[]>;

  /**
   * Find HTS entries by heading
   */
  findByHeading(heading: string): Promise<HtsEntity[]>;

  /**
   * Search HTS entries by description (keyword search)
   */
  search(query: string, limit?: number): Promise<HtsEntity[]>;

  /**
   * Upsert single HTS entry
   */
  upsert(hts: Partial<HtsEntity>): Promise<HtsEntity>;

  /**
   * Upsert batch of HTS entries (optimized for bulk imports)
   */
  upsertBatch(htsList: Partial<HtsEntity>[], batchSize?: number): Promise<void>;

  /**
   * Find all HTS entries with specific parent
   */
  findChildren(parentHtsNumber: string): Promise<HtsEntity[]>;

  /**
   * Find all active HTS entries
   */
  findActive(limit?: number, offset?: number): Promise<HtsEntity[]>;

  /**
   * Count total HTS entries
   */
  count(filters?: { chapter?: string; isActive?: boolean }): Promise<number>;

  /**
   * Delete HTS entry by number
   */
  deleteByNumber(htsNumber: string): Promise<void>;

  /**
   * Mark entries from old version as inactive
   */
  deactivateOldEntries(excludeVersion: string): Promise<number>;
}
