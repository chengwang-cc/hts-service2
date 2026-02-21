import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { HtsEntity } from '../entities/hts.entity';
import { IHtsRepository } from '../interfaces/hts-repository.interface';

/**
 * HTS Repository Implementation
 * Handles all database operations for HTS entities
 */
@Injectable()
export class HtsRepository implements IHtsRepository {
  private readonly logger = new Logger(HtsRepository.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly repository: Repository<HtsEntity>,
  ) {}

  /**
   * Find HTS entry by exact HTS number
   */
  async findByNumber(htsNumber: string): Promise<HtsEntity | null> {
    return this.repository.findOne({
      where: { htsNumber, isActive: true },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Find HTS entries by chapter
   */
  async findByChapter(chapter: string): Promise<HtsEntity[]> {
    return this.repository.find({
      where: { chapter },
      order: { htsNumber: 'ASC' },
    });
  }

  /**
   * Find HTS entries by heading
   */
  async findByHeading(heading: string): Promise<HtsEntity[]> {
    return this.repository.find({
      where: { heading },
      order: { htsNumber: 'ASC' },
    });
  }

  /**
   * Search HTS entries by description (keyword search)
   * Uses ILIKE for case-insensitive search
   */
  async search(query: string, limit: number = 50): Promise<HtsEntity[]> {
    return this.repository
      .createQueryBuilder('hts')
      .where('hts.description ILIKE :query', { query: `%${query}%` })
      .orWhere('hts.htsNumber ILIKE :query', { query: `%${query}%` })
      .andWhere('hts.isActive = :isActive', { isActive: true })
      .orderBy('hts.htsNumber', 'ASC')
      .limit(limit)
      .getMany();
  }

  /**
   * Upsert single HTS entry
   * Uses htsNumber as unique identifier
   */
  async upsert(hts: Partial<HtsEntity>): Promise<HtsEntity> {
    if (!hts.htsNumber) {
      throw new Error('htsNumber is required for upsert');
    }

    // Find existing
    const existing = await this.repository.findOne({
      where: {
        htsNumber: hts.htsNumber,
        ...(hts.version ? { version: hts.version } : {}),
      },
    });

    if (existing) {
      // Update existing
      Object.assign(existing, hts);
      return this.repository.save(existing);
    } else {
      // Create new
      const newEntity = this.repository.create(hts);
      return this.repository.save(newEntity);
    }
  }

  /**
   * Upsert batch of HTS entries (optimized for bulk imports)
   * Processes in batches to avoid memory issues
   */
  async upsertBatch(
    htsList: Partial<HtsEntity>[],
    batchSize: number = 1000,
  ): Promise<void> {
    const totalBatches = Math.ceil(htsList.length / batchSize);
    this.logger.log(
      `Starting batch upsert: ${htsList.length} entries in ${totalBatches} batches`,
    );

    for (let i = 0; i < htsList.length; i += batchSize) {
      const batch = htsList.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      this.logger.debug(
        `Processing batch ${batchNumber}/${totalBatches} (${batch.length} entries)`,
      );

      // Use TypeORM's upsert with conflict resolution
      await this.repository.upsert(batch, ['htsNumber', 'version']);
    }

    this.logger.log(`Batch upsert completed: ${htsList.length} entries`);
  }

  /**
   * Find all HTS entries with specific parent
   */
  async findChildren(parentHtsNumber: string): Promise<HtsEntity[]> {
    return this.repository.find({
      where: { parentHtsNumber },
      order: { htsNumber: 'ASC' },
    });
  }

  /**
   * Find all active HTS entries with pagination
   */
  async findActive(
    limit: number = 100,
    offset: number = 0,
  ): Promise<HtsEntity[]> {
    return this.repository.find({
      where: { isActive: true },
      order: { htsNumber: 'ASC' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Count total HTS entries
   */
  async count(filters?: {
    chapter?: string;
    isActive?: boolean;
  }): Promise<number> {
    const where: any = {};

    if (filters?.chapter) {
      where.chapter = filters.chapter;
    }

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    return this.repository.count({ where });
  }

  /**
   * Delete HTS entry by number
   */
  async deleteByNumber(htsNumber: string): Promise<void> {
    await this.repository.delete({ htsNumber });
  }

  /**
   * Mark entries from old version as inactive
   * Useful for maintaining only current version as active
   */
  async deactivateOldEntries(excludeVersion: string): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(HtsEntity)
      .set({ isActive: false })
      .where('sourceVersion != :version', { version: excludeVersion })
      .andWhere('isActive = :isActive', { isActive: true })
      .execute();

    const affected = result.affected || 0;
    this.logger.log(
      `Deactivated ${affected} entries from old versions (keeping ${excludeVersion})`,
    );

    return affected;
  }

  /**
   * Find HTS entries by multiple numbers (bulk lookup)
   */
  async findByNumbers(htsNumbers: string[]): Promise<HtsEntity[]> {
    if (htsNumbers.length === 0) return [];

    return this.repository.find({
      where: { htsNumber: In(htsNumbers) },
    });
  }

  /**
   * Get all chapters with entry counts
   */
  async getChapterStats(): Promise<
    Array<{ chapter: string; count: number; activeCount: number }>
  > {
    const result = await this.repository
      .createQueryBuilder('hts')
      .select('hts.chapter', 'chapter')
      .addSelect('COUNT(*)', 'count')
      .addSelect(
        'COUNT(CASE WHEN hts.isActive = true THEN 1 END)',
        'activeCount',
      )
      .groupBy('hts.chapter')
      .orderBy('hts.chapter', 'ASC')
      .getRawMany();

    return result.map((row) => ({
      chapter: row.chapter,
      count: parseInt(row.count, 10),
      activeCount: parseInt(row.activeCount, 10),
    }));
  }
}
