import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '../entities/hts.entity';
import { HtsEmbeddingEntity } from '../entities/hts-embedding.entity';
import { EmbeddingService } from './embedding.service';

/**
 * HTS Embedding Generation Service
 * Generates and manages embeddings for HTS codes to enable semantic search
 */
@Injectable()
export class HtsEmbeddingGenerationService {
  private readonly logger = new Logger(HtsEmbeddingGenerationService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    @InjectRepository(HtsEmbeddingEntity)
    private readonly embeddingRepository: Repository<HtsEmbeddingEntity>,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * Generate embeddings for all HTS codes
   * Batch processing with configurable batch size
   */
  async generateAllEmbeddings(
    batchSize: number = 100,
    modelVersion: string = 'text-embedding-3-small',
  ): Promise<{
    total: number;
    generated: number;
    skipped: number;
    failed: number;
    errors: string[];
  }> {
    this.logger.log('Starting HTS embedding generation...');

    const result = {
      total: 0,
      generated: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Mark all existing embeddings as not current
    await this.embeddingRepository.update({}, { isCurrent: false });

    // Get all active HTS entries
    const allHts = await this.htsRepository.find({
      where: { isActive: true },
      order: { htsNumber: 'ASC' },
    });

    result.total = allHts.length;
    this.logger.log(`Found ${result.total} active HTS entries`);

    // Process in batches
    for (let i = 0; i < allHts.length; i += batchSize) {
      const batch = allHts.slice(i, i + batchSize);
      this.logger.log(
        `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allHts.length / batchSize)} (${batch.length} entries)`,
      );

      try {
        const generated = await this.generateBatchEmbeddings(batch, modelVersion);
        result.generated += generated;

        // Rate limiting - wait 1 second between batches
        if (i + batchSize < allHts.length) {
          await this.sleep(1000);
        }
      } catch (error) {
        this.logger.error(`Batch processing error: ${error.message}`);
        result.failed += batch.length;
        result.errors.push(
          `Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Embedding generation complete: ${result.generated} generated, ${result.skipped} skipped, ${result.failed} failed`,
    );

    return result;
  }

  /**
   * Generate embeddings for a batch of HTS entries
   */
  private async generateBatchEmbeddings(
    htsEntries: HtsEntity[],
    modelVersion: string,
  ): Promise<number> {
    let generated = 0;

    for (const hts of htsEntries) {
      try {
        // Build search text
        const searchText = this.buildSearchText(hts);

        // Generate embedding
        const embeddingVector = await this.embeddingService.generateEmbedding(searchText);

        // Create embedding entity
        const embedding = this.embeddingRepository.create({
          htsNumber: hts.htsNumber,
          embedding: embeddingVector,
          searchText: searchText,
          model: modelVersion,
          modelVersion: null,
          isCurrent: true,
          generatedAt: new Date(),
        });

        await this.embeddingRepository.save(embedding);
        generated++;
      } catch (error) {
        this.logger.error(
          `Failed to generate embedding for ${hts.htsNumber}: ${error.message}`,
        );
      }
    }

    return generated;
  }

  /**
   * Generate embedding for a single HTS entry
   */
  async generateSingleEmbedding(
    htsNumber: string,
    modelVersion: string = 'text-embedding-3-small',
  ): Promise<HtsEmbeddingEntity> {
    const hts = await this.htsRepository.findOne({
      where: { htsNumber, isActive: true },
    });

    if (!hts) {
      throw new Error(`HTS entry ${htsNumber} not found or inactive`);
    }

    // Mark existing embeddings as not current
    await this.embeddingRepository.update({ htsNumber }, { isCurrent: false });

    // Build search text
    const searchText = this.buildSearchText(hts);

    // Generate embedding
    const embeddingVector = await this.embeddingService.generateEmbedding(searchText);

    // Create embedding entity
    const embedding = this.embeddingRepository.create({
      htsNumber: hts.htsNumber,
      embedding: embeddingVector,
      searchText: searchText,
      model: modelVersion,
      modelVersion: null,
      isCurrent: true,
      generatedAt: new Date(),
    });

    return this.embeddingRepository.save(embedding);
  }

  /**
   * Update embeddings for modified HTS entries
   */
  async updateModifiedEmbeddings(
    since: Date,
    modelVersion: string = 'text-embedding-3-small',
  ): Promise<number> {
    const modifiedHts = await this.htsRepository.find({
      where: { isActive: true },
    });

    // Filter by modification date (compare importDate)
    const toUpdate = modifiedHts.filter(
      (hts) => hts.importDate && hts.importDate > since,
    );

    this.logger.log(`Found ${toUpdate.length} modified HTS entries since ${since}`);

    let updated = 0;
    for (const hts of toUpdate) {
      try {
        await this.generateSingleEmbedding(hts.htsNumber, modelVersion);
        updated++;
      } catch (error) {
        this.logger.error(
          `Failed to update embedding for ${hts.htsNumber}: ${error.message}`,
        );
      }
    }

    return updated;
  }

  /**
   * Build search text from HTS entry
   * Combines HTS number, description, and unit for comprehensive search
   */
  private buildSearchText(hts: HtsEntity): string {
    const parts: string[] = [];

    // HTS number (essential)
    parts.push(hts.htsNumber);

    // Description (primary search field)
    if (hts.description) {
      parts.push(hts.description);
    }

    // Unit of quantity (helps with product type matching)
    if (hts.unitOfQuantity) {
      parts.push(hts.unitOfQuantity);
    }

    // Chapter context (helps with categorization)
    if (hts.chapter) {
      parts.push(`Chapter ${hts.chapter}`);
    }

    // Heading context
    if (hts.heading && hts.heading !== hts.htsNumber) {
      parts.push(`Heading ${hts.heading}`);
    }

    return parts.join(' ');
  }

  /**
   * Get embedding generation statistics
   */
  async getStatistics(): Promise<{
    totalHts: number;
    totalEmbeddings: number;
    currentEmbeddings: number;
    outdatedEmbeddings: number;
    missingEmbeddings: number;
    modelVersions: Record<string, number>;
  }> {
    const totalHts = await this.htsRepository.count({ where: { isActive: true } });
    const totalEmbeddings = await this.embeddingRepository.count();
    const currentEmbeddings = await this.embeddingRepository.count({
      where: { isCurrent: true },
    });

    // Count by model version
    const byModel = await this.embeddingRepository
      .createQueryBuilder('emb')
      .select('emb.modelVersion', 'model')
      .addSelect('COUNT(*)', 'count')
      .where('emb.isCurrent = :current', { current: true })
      .groupBy('emb.modelVersion')
      .getRawMany();

    const modelVersions: Record<string, number> = {};
    byModel.forEach((row) => {
      modelVersions[row.model] = parseInt(row.count, 10);
    });

    return {
      totalHts,
      totalEmbeddings,
      currentEmbeddings,
      outdatedEmbeddings: totalEmbeddings - currentEmbeddings,
      missingEmbeddings: totalHts - currentEmbeddings,
      modelVersions,
    };
  }

  /**
   * Delete outdated embeddings (cleanup)
   */
  async cleanupOutdatedEmbeddings(): Promise<number> {
    const result = await this.embeddingRepository.delete({ isCurrent: false });
    this.logger.log(`Deleted ${result.affected} outdated embeddings`);
    return result.affected || 0;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
