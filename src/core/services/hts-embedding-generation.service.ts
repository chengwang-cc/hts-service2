import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '../entities/hts.entity';
import { EmbeddingService } from './embedding.service';

/**
 * HTS Embedding Generation Service
 * Generates and stores embeddings directly on HtsEntity for semantic search.
 * Embeddings live on the hts table — no separate hts_embeddings table needed.
 */
@Injectable()
export class HtsEmbeddingGenerationService {
  private readonly logger = new Logger(HtsEmbeddingGenerationService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
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

    const allHts = await this.htsRepository.find({
      where: { isActive: true },
      order: { htsNumber: 'ASC' },
    });

    result.total = allHts.length;
    this.logger.log(`Found ${result.total} active HTS entries`);

    for (let i = 0; i < allHts.length; i += batchSize) {
      const batch = allHts.slice(i, i + batchSize);
      this.logger.log(
        `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allHts.length / batchSize)} (${batch.length} entries)`,
      );

      try {
        const generated = await this.generateBatchEmbeddings(
          batch,
          modelVersion,
        );
        result.generated += generated;
        result.failed += batch.length - generated;

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

  private async generateBatchEmbeddings(
    htsEntries: HtsEntity[],
    modelVersion: string,
  ): Promise<number> {
    let generated = 0;

    for (const hts of htsEntries) {
      try {
        await this.generateEmbeddingForEntry(hts, modelVersion);
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
  ): Promise<HtsEntity> {
    const hts = await this.htsRepository.findOne({
      where: { htsNumber, isActive: true },
    });

    if (!hts) {
      throw new Error(`HTS entry ${htsNumber} not found or inactive`);
    }

    await this.generateEmbeddingForEntry(hts, modelVersion);

    const saved = await this.htsRepository.findOne({ where: { id: hts.id } });
    if (!saved) {
      throw new Error(`Failed to persist embedding for ${htsNumber}`);
    }
    return saved;
  }

  /**
   * Regenerate embeddings for all active rows in a specific source version.
   */
  async generateEmbeddingsForSourceVersion(
    sourceVersion: string,
    batchSize: number = 100,
    modelVersion: string = 'text-embedding-3-small',
  ): Promise<{
    total: number;
    generated: number;
    failed: number;
    errors: string[];
  }> {
    const rows = await this.htsRepository.find({
      where: { sourceVersion, isActive: true },
      order: { htsNumber: 'ASC' },
    });

    const result = {
      total: rows.length,
      generated: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const hts of batch) {
        try {
          await this.generateEmbeddingForEntry(hts, modelVersion);
          result.generated++;
        } catch (error) {
          result.failed++;
          result.errors.push(`${hts.htsNumber}: ${error.message}`);
          this.logger.error(
            `Failed to generate embedding for ${hts.htsNumber}: ${error.message}`,
          );
        }
      }

      if (i + batchSize < rows.length) {
        await this.sleep(1000);
      }
    }

    return result;
  }

  /**
   * Update embeddings for HTS entries modified since a given date
   */
  async updateModifiedEmbeddings(
    since: Date,
    modelVersion: string = 'text-embedding-3-small',
  ): Promise<number> {
    const modifiedHts = await this.htsRepository.find({
      where: { isActive: true },
    });

    const toUpdate = modifiedHts.filter(
      (hts) => hts.importDate && hts.importDate > since,
    );

    this.logger.log(
      `Found ${toUpdate.length} modified HTS entries since ${since}`,
    );

    let updated = 0;
    for (const hts of toUpdate) {
      try {
        await this.generateEmbeddingForEntry(hts, modelVersion);
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
   * Get embedding generation statistics
   */
  async getStatistics(): Promise<{
    totalHts: number;
    totalEmbeddings: number;
    missingEmbeddings: number;
    modelVersions: Record<string, number>;
  }> {
    const totalHts = await this.htsRepository.count({
      where: { isActive: true },
    });

    const byModel = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.embeddingModel', 'model')
      .addSelect('COUNT(*)', 'count')
      .where('hts.isActive = :active', { active: true })
      .andWhere('hts.embedding IS NOT NULL')
      .groupBy('hts.embeddingModel')
      .getRawMany();

    const modelVersions: Record<string, number> = {};
    let totalEmbeddings = 0;
    byModel.forEach((row) => {
      const count = parseInt(row.count, 10);
      modelVersions[row.model ?? 'unknown'] = count;
      totalEmbeddings += count;
    });

    return {
      totalHts,
      totalEmbeddings,
      missingEmbeddings: totalHts - totalEmbeddings,
      modelVersions,
    };
  }

  /**
   * Build search text from HTS entry for embedding generation
   */
  private buildSearchText(hts: HtsEntity): string {
    const parts = this.dedupeTextParts([
      this.normalizeTextPart(hts.htsNumber),
      ...this.buildEmbeddingDescriptionParts(hts),
      this.normalizeTextPart(hts.unitOfQuantity),
    ]);

    return parts.join(' ');
  }

  private async generateEmbeddingForEntry(
    hts: HtsEntity,
    modelVersion: string,
  ): Promise<void> {
    const searchText = this.buildSearchText(hts);
    const embeddingVector =
      await this.embeddingService.generateEmbedding(searchText);

    const updatePayload: Partial<HtsEntity> = {
      embedding: embeddingVector,
      embeddingSearchText: searchText,
      embeddingModel: modelVersion,
      embeddingGeneratedAt: new Date(),
    };

    if (
      !Array.isArray(hts.fullDescription) ||
      hts.fullDescription.length === 0
    ) {
      const fallbackFullDescription = this.buildFallbackFullDescription(hts);
      if (fallbackFullDescription.length > 0) {
        updatePayload.fullDescription = fallbackFullDescription;
      }
    }

    await this.htsRepository.update({ id: hts.id }, updatePayload);
  }

  /**
   * Canonical full description used for embedding indexing:
   * chapter + heading + subheading + description.
   * If ancestor description breadcrumbs exist, keep them as additional context.
   */
  private buildEmbeddingDescriptionParts(hts: HtsEntity): string[] {
    const parts: string[] = [];

    if (hts.chapter) {
      parts.push(`Chapter ${hts.chapter}`);
    }
    if (hts.heading) {
      parts.push(`Heading ${hts.heading}`);
    }
    if (hts.subheading) {
      parts.push(`Subheading ${hts.subheading}`);
    }

    const hierarchyDescriptions = this.normalizeDescriptionArray(
      hts.fullDescription,
    );
    if (hierarchyDescriptions.length > 0) {
      parts.push(...hierarchyDescriptions);
    } else {
      const description = this.normalizeTextPart(hts.description);
      if (description) {
        parts.push(description);
      }
    }

    return parts;
  }

  private buildFallbackFullDescription(hts: HtsEntity): string[] {
    const description = this.normalizeTextPart(hts.description);
    const parts = this.dedupeTextParts([
      hts.chapter ? `Chapter ${hts.chapter}` : '',
      hts.heading ? `Heading ${hts.heading}` : '',
      hts.subheading ? `Subheading ${hts.subheading}` : '',
      description,
    ]);

    return parts;
  }

  private normalizeDescriptionArray(
    value: string[] | null | undefined,
  ): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.normalizeTextPart(entry))
      .filter((entry): entry is string => entry.length > 0);
  }

  private normalizeTextPart(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    return value.replace(/\s+/g, ' ').trim();
  }

  private dedupeTextParts(parts: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const part of parts) {
      const clean = this.normalizeTextPart(part);
      if (!clean) {
        continue;
      }
      const key = clean.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      normalized.push(clean);
    }

    return normalized;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
