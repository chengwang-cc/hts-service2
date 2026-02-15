import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  HtsNoteEntity,
  HtsNoteReferenceEntity,
  HtsNoteEmbeddingEntity,
  HtsNoteRateEntity,
} from '../entities';
import { EmbeddingService } from '@hts/core';

@Injectable()
export class NoteResolutionService {
  private readonly logger = new Logger(NoteResolutionService.name);

  constructor(
    @InjectRepository(HtsNoteEntity)
    private readonly noteRepository: Repository<HtsNoteEntity>,
    @InjectRepository(HtsNoteReferenceEntity)
    private readonly referenceRepository: Repository<HtsNoteReferenceEntity>,
    @InjectRepository(HtsNoteEmbeddingEntity)
    private readonly embeddingRepository: Repository<HtsNoteEmbeddingEntity>,
    @InjectRepository(HtsNoteRateEntity)
    private readonly noteRateRepository: Repository<HtsNoteRateEntity>,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async resolveNoteReference(
    htsNumber: string,
    referenceText?: string,
    sourceColumn: 'general' | 'other' | 'special' = 'general',
    year?: number,
    options?: { exactOnly?: boolean },
  ): Promise<any> {
    // Try exact match first
    const exactMatch = await this.exactMatch(referenceText || '', htsNumber, year);
    if (exactMatch) {
      const result = await this.buildResult(exactMatch, 'exact', 1.0, htsNumber);

      // Persist resolution attempt
      await this.saveResolutionReference(
        htsNumber,
        referenceText || '',
        exactMatch.id,
        'exact',
        1.0,
        sourceColumn,
        year ?? exactMatch.year,
        result.formula,
      );

      return result;
    }

    // Try semantic search
    if (referenceText && !options?.exactOnly) {
      const semanticMatch = await this.semanticSearch(referenceText, htsNumber, year);
      if (semanticMatch && semanticMatch.confidence >= 0.8) {
        const result = await this.buildResult(
          semanticMatch.note,
          'semantic',
          semanticMatch.confidence,
          htsNumber,
        );

        // Persist resolution attempt
        await this.saveResolutionReference(
          htsNumber,
          referenceText,
          semanticMatch.note.id,
          'semantic',
          semanticMatch.confidence,
          sourceColumn,
          year ?? semanticMatch.note.year,
          result.formula,
        );

        return result;
      }
    }

    return null;
  }

  private async exactMatch(
    referenceText: string,
    htsNumber: string,
    year?: number,
  ): Promise<HtsNoteEntity | null> {
    const noteNumberMatch = referenceText.match(
      /note[s]?\s+(\d+[a-z]?(?:\([a-z0-9ivx]+\))*)/i,
    );
    if (!noteNumberMatch) return null;

    const noteType = this.detectNoteType(referenceText);
    const chapter = htsNumber ? htsNumber.substring(0, 2) : null;
    const baseWhere = {
      noteNumber: noteNumberMatch[1],
      ...(chapter ? { chapter } : {}),
      ...(year ? { year } : {}),
    };

    if (noteType) {
      const typedMatch = await this.noteRepository.findOne({
        where: {
          ...baseWhere,
          noteType,
        },
      });

      if (typedMatch) {
        return typedMatch;
      }
    }

    // Fallback: allow matches without inferred note type.
    return this.noteRepository.findOne({
      where: baseWhere,
    });
  }

  private async semanticSearch(
    referenceText: string,
    htsNumber: string,
    year?: number,
  ): Promise<{ note: HtsNoteEntity; confidence: number } | null> {
    const embedding = await this.embeddingService.generateEmbedding(referenceText);

    const results = await this.embeddingRepository
      .createQueryBuilder('embedding')
      .select('embedding.noteId', 'noteId')
      .addSelect('1 - (embedding.embedding <=> :embedding)', 'similarity')
      .setParameter('embedding', JSON.stringify(embedding))
      .andWhere('embedding.isCurrent = true')
      .orderBy('similarity', 'DESC')
      .limit(1)
      .getRawOne();

    const similarity = results ? parseFloat(results.similarity) : 0;
    if (!results || Number.isNaN(similarity) || similarity < 0.8) return null;

    const chapter = htsNumber ? htsNumber.substring(0, 2) : null;
    const note = await this.noteRepository.findOne({
      where: {
        id: results.noteId,
        ...(chapter ? { chapter } : {}),
        ...(year ? { year } : {}),
      },
    });

    return note ? { note, confidence: similarity } : null;
  }

  private async buildResult(
    note: HtsNoteEntity,
    method: string,
    confidence: number,
    htsNumber: string,
  ): Promise<any> {
    // Load formula from HtsNoteRateEntity if available
    const noteRate = await this.noteRateRepository.findOne({
      where: { noteId: note.id },
      order: { confidence: 'DESC' },
    });

    return {
      htsNumber,
      noteNumber: note.noteNumber,
      noteContent: note.content,
      formula: noteRate?.formula || null,
      variables: noteRate?.variables || null,
      rateType: noteRate?.rateType || null,
      confidence,
      resolutionMethod: method,
      metadata: {
        noteId: note.id,
        noteType: note.noteType,
        chapter: note.chapter,
        year: note.year,
      },
    };
  }

  /**
   * Save resolution reference for audit trail
   */
  private async saveResolutionReference(
    htsNumber: string,
    referenceText: string,
    noteId: string,
    resolutionMethod: string,
    confidence: number,
    sourceColumn: string,
    year?: number,
    resolvedFormula?: string | null,
  ): Promise<void> {
    try {
      const reference = this.referenceRepository.create({
        htsNumber,
        referenceText,
        noteId,
        sourceColumn,
        year: year ?? new Date().getFullYear(),
        active: true,
        resolutionMethod,
        confidence,
        resolvedFormula: resolvedFormula ?? null,
        isResolved: true,
        resolvedAt: new Date(),
        resolutionMetadata: {
          sourceColumn,
          year,
        },
      });

      await this.referenceRepository.save(reference);
    } catch (error) {
      // Log but don't throw - resolution reference is for audit trail only
      this.logger.warn(`Failed to save resolution reference: ${error.message}`);
    }
  }

  private detectNoteType(referenceText: string): string | null {
    const text = referenceText.toLowerCase();
    if (text.includes('additional')) return 'ADDITIONAL_US_NOTE';
    if (text.includes('general')) return 'GENERAL_NOTE';
    if (text.includes('statistical')) return 'STATISTICAL_NOTE';
    if (text.includes('section')) return 'SECTION_NOTE';
    if (text.includes('chapter')) return 'CHAPTER_NOTE';
    return null;
  }
}
