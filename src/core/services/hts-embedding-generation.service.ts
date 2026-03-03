import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '../entities/hts.entity';
import { EmbeddingService } from './embedding.service';
import { OpenAiService } from './openai.service';

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
    private readonly openAiService: OpenAiService,
  ) {}

  /**
   * Generate embeddings for all HTS codes, writing to the column for the
   * active SEARCH_EMBEDDING_PROVIDER (dgx → `embedding`, openai → `embedding_openai`).
   *
   * @param onlyMissing  When true (default), skip rows that already have an embedding
   *                     in the target column. Pass false to regenerate all.
   */
  async generateAllEmbeddings(
    batchSize: number = 100,
    modelVersion: string = 'text-embedding-3-small',
    onlyMissing: boolean = true,
  ): Promise<{
    total: number;
    generated: number;
    skipped: number;
    failed: number;
    errors: string[];
  }> {
    const { provider, column } = this.embeddingService.providerInfo;
    this.logger.log(
      `Starting HTS embedding generation — provider: ${provider}, column: ${column}, onlyMissing: ${onlyMissing}`,
    );

    const result = {
      total: 0,
      generated: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Build DB query — filter NULL at DB level rather than loading vector columns into memory.
    // Both `embedding` and `embeddingOpenai` are `select: false`, so they are never populated
    // by find() — in-memory filtering with `hts.embeddingOpenai == null` always returns true
    // (undefined == null) and would process every row on every run.
    const { property } = this.embeddingService.providerInfo;
    const queryBuilder = this.htsRepository
      .createQueryBuilder('hts')
      .where('hts.isActive = :active', { active: true })
      .orderBy('hts.htsNumber', 'ASC');
    if (onlyMissing) {
      queryBuilder.andWhere(`hts.${property} IS NULL`);
    }

    const [toProcess, totalActive] = await Promise.all([
      queryBuilder.getMany(),
      this.htsRepository.count({ where: { isActive: true } }),
    ]);

    result.total = toProcess.length;
    result.skipped = totalActive - toProcess.length;
    this.logger.log(
      `${result.total} entries to process (${result.skipped} already have ${column} embeddings, skipped)`,
    );

    for (let i = 0; i < toProcess.length; i += batchSize) {
      const batch = toProcess.slice(i, i + batchSize);
      this.logger.log(
        `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(toProcess.length / batchSize)} (${batch.length} entries)`,
      );

      try {
        const batchResult = await this.generateBatchEmbeddings(
          batch,
          modelVersion,
        );
        result.generated += batchResult.generated;
        result.failed += batchResult.failed;
        if (batchResult.errors.length > 0) {
          result.errors.push(...batchResult.errors.slice(0, 20));
        }

        if (i + batchSize < toProcess.length) {
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
  ): Promise<{ generated: number; failed: number; errors: string[] }> {
    if (htsEntries.length === 0) {
      return { generated: 0, failed: 0, errors: [] };
    }

    const searchTexts = htsEntries.map((hts) => this.buildSearchText(hts));
    let embeddings: number[][];

    try {
      embeddings = await this.embeddingService.generateBatch(searchTexts);
    } catch (error) {
      const batchError = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Batch embedding API failed for ${htsEntries.length} rows, falling back to one-by-one generation: ${batchError}`,
      );

      let generated = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const hts of htsEntries) {
        try {
          await this.generateEmbeddingForEntry(hts, modelVersion);
          generated++;
        } catch (singleError) {
          failed++;
          const message =
            singleError instanceof Error
              ? singleError.message
              : String(singleError);
          errors.push(`${hts.htsNumber}: ${message}`);
          this.logger.error(
            `Failed to generate embedding for ${hts.htsNumber}: ${message}`,
          );
        }
      }

      return { generated, failed, errors };
    }

    let generated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let index = 0; index < htsEntries.length; index++) {
      const hts = htsEntries[index];
      const embeddingVector = embeddings[index];

      if (!Array.isArray(embeddingVector) || embeddingVector.length === 0) {
        failed++;
        errors.push(`${hts.htsNumber}: empty embedding vector`);
        this.logger.error(
          `Failed to generate embedding for ${hts.htsNumber}: empty embedding vector`,
        );
        continue;
      }

      try {
        const { column } = this.embeddingService.providerInfo;
        const updatePayload: Partial<HtsEntity> =
          column === 'embedding_openai'
            ? {
                embeddingOpenai: embeddingVector,
                embeddingSearchText: searchTexts[index],
                embeddingOpenaiGeneratedAt: new Date(),
              }
            : {
                embedding: embeddingVector,
                embeddingSearchText: searchTexts[index],
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
        generated++;
      } catch (persistError) {
        failed++;
        const message =
          persistError instanceof Error
            ? persistError.message
            : String(persistError);
        errors.push(`${hts.htsNumber}: ${message}`);
        this.logger.error(
          `Failed to persist embedding for ${hts.htsNumber}: ${message}`,
        );
      }
    }

    return { generated, failed, errors };
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
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(rows.length / batchSize);
      this.logger.log(
        `Refreshing embeddings batch ${batchNumber}/${totalBatches} (${batch.length} entries)`,
      );

      const batchResult = await this.generateBatchEmbeddings(batch, modelVersion);
      result.generated += batchResult.generated;
      result.failed += batchResult.failed;
      if (batchResult.errors.length > 0) {
        result.errors.push(...batchResult.errors.slice(0, 20));
      }

      this.logger.log(
        `Batch ${batchNumber}/${totalBatches} complete: generated=${batchResult.generated}, failed=${batchResult.failed}, progress=${result.generated + result.failed}/${result.total}`,
      );

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
   * Generate OpenAI embeddings (text-embedding-3-small, 1536-dim) into the
   * `embedding_openai` column, regardless of the active SEARCH_EMBEDDING_PROVIDER.
   *
   * Use this to pre-populate the OpenAI column so you can switch providers
   * without any downtime. Safe to run while DGX is the active provider.
   *
   * @param batchSize    Number of entries to embed per API call (default 100)
   * @param onlyMissing  Skip rows that already have embedding_openai (default true)
   */
  async generateOpenAiEmbeddings(
    batchSize: number = 100,
    onlyMissing: boolean = true,
  ): Promise<{
    total: number;
    generated: number;
    skipped: number;
    failed: number;
    errors: string[];
  }> {
    const model = 'text-embedding-3-small';
    this.logger.log(
      `Starting OpenAI embedding reindex — model: ${model}, onlyMissing: ${onlyMissing}`,
    );

    const result = { total: 0, generated: 0, skipped: 0, failed: 0, errors: [] as string[] };

    // Filter NULL at DB level — `embeddingOpenai` is `select: false`, so it is never
    // populated by find(). In-memory `hts.embeddingOpenai == null` is always true
    // (undefined == null) and would process every row regardless of onlyMissing.
    const queryBuilder = this.htsRepository
      .createQueryBuilder('hts')
      .where('hts.isActive = :active', { active: true })
      .orderBy('hts.htsNumber', 'ASC');
    if (onlyMissing) {
      queryBuilder.andWhere('hts.embeddingOpenai IS NULL');
    }

    const [toProcess, totalActive] = await Promise.all([
      queryBuilder.getMany(),
      this.htsRepository.count({ where: { isActive: true } }),
    ]);

    result.skipped = totalActive - toProcess.length;
    result.total = toProcess.length;
    this.logger.log(
      `${result.total} entries to process (${result.skipped} already have embedding_openai, skipped)`,
    );

    for (let i = 0; i < toProcess.length; i += batchSize) {
      const batch = toProcess.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(toProcess.length / batchSize);
      this.logger.log(`OpenAI reindex batch ${batchNum}/${totalBatches} (${batch.length} entries)`);

      const searchTexts = batch.map((hts) => this.buildSearchText(hts));
      let embeddings: number[][];

      try {
        embeddings = await this.openAiService.generateEmbeddingBatch(searchTexts, model);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Batch ${batchNum} API call failed: ${msg}`);
        result.failed += batch.length;
        result.errors.push(`Batch ${batchNum}: ${msg}`);
        if (i + batchSize < toProcess.length) await this.sleep(2000);
        continue;
      }

      for (let j = 0; j < batch.length; j++) {
        const hts = batch[j];
        const vec = embeddings[j];
        if (!Array.isArray(vec) || vec.length === 0) {
          result.failed++;
          result.errors.push(`${hts.htsNumber}: empty vector`);
          continue;
        }
        try {
          await this.htsRepository.update(
            { id: hts.id },
            { embeddingOpenai: vec, embeddingOpenaiGeneratedAt: new Date() },
          );
          result.generated++;
        } catch (persistErr) {
          const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
          result.failed++;
          result.errors.push(`${hts.htsNumber}: ${msg}`);
        }
      }

      this.logger.log(
        `Batch ${batchNum}/${totalBatches} done — generated: ${result.generated}, failed: ${result.failed}`,
      );
      if (i + batchSize < toProcess.length) await this.sleep(1000);
    }

    this.logger.log(
      `OpenAI reindex complete — generated: ${result.generated}, skipped: ${result.skipped}, failed: ${result.failed}`,
    );
    return result;
  }

  /**
   * Get embedding generation statistics
   */
  async getStatistics(): Promise<{
    totalHts: number;
    dgx: { total: number; missing: number };
    openai: { total: number; missing: number };
    activeProvider: string;
    activeColumn: string;
  }> {
    const totalHts = await this.htsRepository.count({ where: { isActive: true } });

    const [dgxCount, openaiCount] = await Promise.all([
      this.htsRepository
        .createQueryBuilder('hts')
        .where('hts.isActive = :active', { active: true })
        .andWhere('hts.embedding IS NOT NULL')
        .getCount(),
      this.htsRepository
        .createQueryBuilder('hts')
        .where('hts.isActive = :active', { active: true })
        .andWhere('hts.embeddingOpenai IS NOT NULL')
        .getCount(),
    ]);

    const { provider, column } = this.embeddingService.providerInfo;

    return {
      totalHts,
      dgx: { total: dgxCount, missing: totalHts - dgxCount },
      openai: { total: openaiCount, missing: totalHts - openaiCount },
      activeProvider: provider,
      activeColumn: column,
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
    const embeddingVector = await this.embeddingService.generateEmbedding(searchText);
    const { column } = this.embeddingService.providerInfo;

    const updatePayload: Partial<HtsEntity> =
      column === 'embedding_openai'
        ? {
            embeddingOpenai: embeddingVector,
            embeddingSearchText: searchText,
            embeddingOpenaiGeneratedAt: new Date(),
          }
        : {
            embedding: embeddingVector,
            embeddingSearchText: searchText,
            embeddingModel: modelVersion,
            embeddingGeneratedAt: new Date(),
          };

    if (!Array.isArray(hts.fullDescription) || hts.fullDescription.length === 0) {
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
