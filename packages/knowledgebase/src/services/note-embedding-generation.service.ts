import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsNoteEntity } from '../entities/hts-note.entity';
import { HtsNoteEmbeddingEntity } from '../entities/hts-note-embedding.entity';
import { EmbeddingService } from '@hts/core';

/**
 * Note Embedding Generation Service
 * Generates and manages embeddings for HTS notes to enable semantic note resolution
 */
@Injectable()
export class NoteEmbeddingGenerationService {
  private readonly logger = new Logger(NoteEmbeddingGenerationService.name);

  constructor(
    @InjectRepository(HtsNoteEntity)
    private readonly noteRepository: Repository<HtsNoteEntity>,
    @InjectRepository(HtsNoteEmbeddingEntity)
    private readonly embeddingRepository: Repository<HtsNoteEmbeddingEntity>,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * Generate embeddings for all notes
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
    this.logger.log('Starting note embedding generation...');

    const result = {
      total: 0,
      generated: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Mark all existing embeddings as not current
    await this.embeddingRepository.update({}, { isCurrent: false });

    // Get all notes
    const allNotes = await this.noteRepository.find({
      order: { noteNumber: 'ASC' },
    });

    result.total = allNotes.length;
    this.logger.log(`Found ${result.total} notes`);

    // Process in batches
    for (let i = 0; i < allNotes.length; i += batchSize) {
      const batch = allNotes.slice(i, i + batchSize);
      this.logger.log(
        `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allNotes.length / batchSize)} (${batch.length} notes)`,
      );

      try {
        const generated = await this.generateBatchEmbeddings(
          batch,
          modelVersion,
        );
        result.generated += generated;

        // Rate limiting - wait 1 second between batches
        if (i + batchSize < allNotes.length) {
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
   * Generate embeddings for a batch of notes
   */
  private async generateBatchEmbeddings(
    notes: HtsNoteEntity[],
    modelVersion: string,
  ): Promise<number> {
    let generated = 0;

    for (const note of notes) {
      try {
        // Build search text
        const searchText = this.buildSearchText(note);

        // Skip if no meaningful content
        if (!searchText || searchText.length < 10) {
          this.logger.warn(`Skipping note ${note.id}: insufficient content`);
          continue;
        }

        // Generate embedding
        const embeddingVector = await this.embeddingService.generateEmbedding(
          searchText,
        );

        const existing = await this.embeddingRepository.findOne({
          where: { noteId: note.id },
        });

        if (existing) {
          existing.embedding = embeddingVector;
          existing.searchText = searchText;
          existing.model = modelVersion;
          existing.isCurrent = true;
          existing.generatedAt = new Date();
          await this.embeddingRepository.save(existing);
        } else {
          const embedding = this.embeddingRepository.create({
            noteId: note.id,
            embedding: embeddingVector,
            searchText,
            model: modelVersion,
            isCurrent: true,
            generatedAt: new Date(),
          });
          await this.embeddingRepository.save(embedding);
        }

        generated++;
      } catch (error) {
        this.logger.error(
          `Failed to generate embedding for note ${note.id}: ${error.message}`,
        );
      }
    }

    return generated;
  }

  /**
   * Generate embedding for a single note
   */
  async generateSingleEmbedding(
    noteId: string,
    modelVersion: string = 'text-embedding-3-small',
  ): Promise<HtsNoteEmbeddingEntity> {
    const note = await this.noteRepository.findOne({
      where: { id: noteId },
    });

    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    // Build search text
    const searchText = this.buildSearchText(note);

    if (!searchText || searchText.length < 10) {
      throw new Error('Insufficient content for embedding generation');
    }

    // Generate embedding
    const embeddingVector = await this.embeddingService.generateEmbedding(
      searchText,
    );

    const existing = await this.embeddingRepository.findOne({
      where: { noteId: note.id },
    });

    if (existing) {
      existing.embedding = embeddingVector;
      existing.searchText = searchText;
      existing.model = modelVersion;
      existing.isCurrent = true;
      existing.generatedAt = new Date();
      return this.embeddingRepository.save(existing);
    }

    const embedding = this.embeddingRepository.create({
      noteId: note.id,
      embedding: embeddingVector,
      searchText,
      model: modelVersion,
      isCurrent: true,
      generatedAt: new Date(),
    });

    return this.embeddingRepository.save(embedding);
  }

  /**
   * Build search text from note
   * Combines note number, title, content, and metadata for comprehensive search
   */
  private buildSearchText(note: HtsNoteEntity): string {
    const parts: string[] = [];

    // Note number (essential for direct matching)
    if (note.noteNumber) {
      parts.push(note.noteNumber);
    }

    // Note type (helps with categorization)
    if (note.noteType) {
      parts.push(note.noteType);
    }

    // Title (primary descriptor)
    if (note.title) {
      parts.push(note.title);
    }

    // Content (main search field)
    if (note.content) {
      parts.push(note.content);
    }

    // Rate text (if mentioned, important for duty calculations)
    if (note.scope) {
      parts.push(`Scope: ${note.scope}`);
    }

    if (note.chapter) {
      parts.push(`Chapter ${note.chapter}`);
    }

    if (note.year) {
      parts.push(`Year ${note.year}`);
    }

    return parts.join(' ');
  }

  /**
   * Get embedding generation statistics
   */
  async getStatistics(): Promise<{
    totalNotes: number;
    totalEmbeddings: number;
    currentEmbeddings: number;
    outdatedEmbeddings: number;
    missingEmbeddings: number;
    modelVersions: Record<string, number>;
    byNoteType: Record<string, number>;
  }> {
    const totalNotes = await this.noteRepository.count();
    const totalEmbeddings = await this.embeddingRepository.count();
    const currentEmbeddings = await this.embeddingRepository.count({
      where: { isCurrent: true },
    });

    // Count by model version
    const byModel = await this.embeddingRepository
      .createQueryBuilder('emb')
      .select('emb.model', 'model')
      .addSelect('COUNT(*)', 'count')
      .where('emb.isCurrent = :current', { current: true })
      .groupBy('emb.model')
      .getRawMany();

    const modelVersions: Record<string, number> = {};
    byModel.forEach((row) => {
      modelVersions[row.model] = parseInt(row.count, 10);
    });

    // Count by note type
    const byType = await this.embeddingRepository
      .createQueryBuilder('emb')
      .innerJoin(HtsNoteEntity, 'note', 'note.id = emb.noteId')
      .select('note.noteType', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('emb.isCurrent = :current', { current: true })
      .groupBy('note.noteType')
      .getRawMany();

    const byNoteType: Record<string, number> = {};
    byType.forEach((row) => {
      byNoteType[row.type] = parseInt(row.count, 10);
    });

    return {
      totalNotes,
      totalEmbeddings,
      currentEmbeddings,
      outdatedEmbeddings: totalEmbeddings - currentEmbeddings,
      missingEmbeddings: totalNotes - currentEmbeddings,
      modelVersions,
      byNoteType,
    };
  }

  /**
   * Update embeddings for newly added notes
   */
  async updateNewNotes(
    since: Date,
    modelVersion: string = 'text-embedding-3-small',
  ): Promise<number> {
    const newNotes = await this.noteRepository
      .createQueryBuilder('note')
      .where('note.createdAt > :since', { since })
      .getMany();

    this.logger.log(`Found ${newNotes.length} new notes since ${since}`);

    let updated = 0;
    for (const note of newNotes) {
      try {
        await this.generateSingleEmbedding(note.id, modelVersion);
        updated++;
      } catch (error) {
        this.logger.error(
          `Failed to generate embedding for note ${note.id}: ${error.message}`,
        );
      }
    }

    return updated;
  }

  /**
   * Delete outdated embeddings (cleanup)
   */
  async cleanupOutdatedEmbeddings(): Promise<number> {
    const result = await this.embeddingRepository.delete({ isCurrent: false });
    this.logger.log(`Deleted ${result.affected} outdated note embeddings`);
    return result.affected || 0;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
