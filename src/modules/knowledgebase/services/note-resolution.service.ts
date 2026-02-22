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

interface ParsedNoteReference {
  noteNumber: string;
  noteType: string | null;
  chapter: string | null;
}

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
    options?: { exactOnly?: boolean; persistResolution?: boolean },
  ): Promise<any> {
    const parsedReference = this.parseNoteReference(
      referenceText || '',
      htsNumber,
    );
    if (!parsedReference) {
      return null;
    }

    // Try exact match first
    const exactMatch = await this.exactMatch(parsedReference, year);
    if (exactMatch) {
      const result = await this.buildResult(
        exactMatch,
        'exact',
        1.0,
        htsNumber,
      );

      // Persist resolution attempt
      if (options?.persistResolution !== false) {
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
      }

      return result;
    }

    // Try semantic search
    if (referenceText && !options?.exactOnly) {
      const semanticMatch = await this.semanticSearch(
        referenceText,
        parsedReference.chapter ?? null,
        year,
      );
      if (semanticMatch && semanticMatch.confidence >= 0.8) {
        const result = await this.buildResult(
          semanticMatch.note,
          'semantic',
          semanticMatch.confidence,
          htsNumber,
        );

        // Persist resolution attempt
        if (options?.persistResolution !== false) {
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
        }

        return result;
      }
    }

    return null;
  }

  private parseNoteReference(
    referenceText: string,
    htsNumber: string,
  ): ParsedNoteReference | null {
    const noteNumber = this.extractNoteNumber(referenceText);

    if (!noteNumber) {
      return null;
    }

    return {
      noteNumber,
      noteType: this.detectNoteType(referenceText),
      chapter: this.extractTargetChapter(referenceText, htsNumber),
    };
  }

  private extractNoteNumber(value: string): string | null {
    if (!value) {
      return null;
    }

    const patterns = [
      /(?:u\.?\s*s\.?\s*)?note[s]?\s*(?:no\.?|number)?\s*([0-9]+[a-z]?(?:\([a-z0-9ivx]+\))*)/i,
    ];

    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (!match?.[1]) {
        continue;
      }
      return match[1].trim().replace(/[.;:,]+$/g, '');
    }

    return null;
  }

  private extractTargetChapter(
    referenceText: string,
    htsNumber: string,
  ): string | null {
    const chapterFromText = referenceText.match(/\bchapter\s+(\d{1,2})\b/i);
    if (chapterFromText?.[1]) {
      return chapterFromText[1].padStart(2, '0');
    }

    const htsFromText = referenceText.match(/\b(\d{4}(?:\.\d{2}){1,3})\b/);
    if (htsFromText?.[1]) {
      return htsFromText[1].slice(0, 2);
    }

    const normalizedHts = (htsNumber || '').replace(/[^0-9]/g, '');
    if (normalizedHts.length >= 2) {
      return normalizedHts.slice(0, 2);
    }

    return null;
  }

  private async exactMatch(
    parsed: ParsedNoteReference,
    year?: number,
  ): Promise<HtsNoteEntity | null> {
    const typedMatch = parsed.noteType
      ? await this.queryBestNote(
          parsed.noteNumber,
          parsed.chapter,
          year,
          parsed.noteType,
        )
      : null;

    if (typedMatch) {
      return typedMatch;
    }

    return this.queryBestNote(parsed.noteNumber, parsed.chapter, year);
  }

  private async queryBestNote(
    noteNumber: string,
    chapter: string | null,
    year?: number,
    noteType?: string | null,
  ): Promise<HtsNoteEntity | null> {
    const chapterCandidates = this.getChapterCandidates(chapter);
    const query = this.noteRepository
      .createQueryBuilder('note')
      .leftJoin('note.document', 'document')
      .where('note.note_number = :noteNumber', { noteNumber });

    if (chapterCandidates.length === 1) {
      query.andWhere('note.chapter = :chapter', {
        chapter: chapterCandidates[0],
      });
    } else if (chapterCandidates.length > 1) {
      query.andWhere('note.chapter IN (:...chapters)', {
        chapters: chapterCandidates,
      });
    }

    if (year) {
      query.andWhere('note.year = :year', { year });
    }

    if (noteType) {
      query.andWhere('note.type = :noteType', { noteType });
    }

    if (chapter && chapter !== '00') {
      query
        .addSelect(
          'CASE WHEN note.chapter = :primaryChapter THEN 0 ELSE 1 END',
          'chapter_rank',
        )
        .setParameter('primaryChapter', chapter)
        .orderBy('chapter_rank', 'ASC')
        .addOrderBy('note.year', 'DESC');
    } else {
      query.orderBy('note.year', 'DESC');
    }

    query
      .addOrderBy('document.processed_at', 'DESC', 'NULLS LAST')
      .addOrderBy('note.updated_at', 'DESC')
      .addOrderBy('note.created_at', 'DESC')
      .limit(1);

    const rows = await query.getMany();
    return rows[0] ?? null;
  }

  private async semanticSearch(
    referenceText: string,
    chapter: string | null,
    year?: number,
  ): Promise<{ note: HtsNoteEntity; confidence: number } | null> {
    const chapterCandidates = this.getChapterCandidates(chapter);
    const embedding = await this.embeddingService.generateEmbedding(referenceText);

    const query = this.embeddingRepository
      .createQueryBuilder('embedding')
      .innerJoin(HtsNoteEntity, 'note', 'note.id = embedding.noteId')
      .select('embedding.noteId', 'noteId')
      .addSelect('1 - (embedding.embedding <=> :embedding)', 'similarity')
      .where('embedding.isCurrent = true')
      .setParameter('embedding', JSON.stringify(embedding));

    if (year) {
      query.andWhere('note.year = :year', { year });
    }

    if (chapterCandidates.length) {
      query.andWhere('note.chapter IN (:...chapters)', {
        chapters: chapterCandidates,
      });
    }

    if (chapter && chapter !== '00') {
      query
        .addSelect(
          'CASE WHEN note.chapter = :primaryChapter THEN 0 ELSE 1 END',
          'chapterRank',
        )
        .setParameter('primaryChapter', chapter)
        .orderBy('chapterRank', 'ASC')
        .addOrderBy('similarity', 'DESC');
    } else {
      query.orderBy('similarity', 'DESC');
    }

    const results = await query.limit(10).getRawMany();

    for (const row of results) {
      const similarity = parseFloat(row.similarity);
      if (Number.isNaN(similarity) || similarity < 0.8) {
        continue;
      }

      const note = await this.noteRepository.findOne({
        where: { id: row.noteId },
      });

      if (note) {
        return { note, confidence: similarity };
      }
    }

    return null;
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
      const resolvedYear = year ?? new Date().getFullYear();
      const now = new Date();
      const reference = this.referenceRepository.create({
        htsNumber,
        referenceText,
        noteId,
        sourceColumn,
        year: resolvedYear,
        active: true,
        resolutionMethod,
        confidence,
        resolvedFormula: resolvedFormula ?? null,
        isResolved: true,
        resolvedAt: now,
        resolutionMetadata: {
          sourceColumn,
          year: resolvedYear,
        },
      });

      const existing = await this.referenceRepository
        .createQueryBuilder('ref')
        .where('ref.hts_number = :htsNumber', { htsNumber })
        .andWhere('ref.note_id = :noteId', { noteId })
        .andWhere('ref.source_column = :sourceColumn', { sourceColumn })
        .andWhere('ref.year = :resolvedYear', { resolvedYear })
        .orderBy('ref.updated_at', 'DESC')
        .limit(1)
        .getOne();

      if (existing) {
        existing.referenceText = reference.referenceText;
        existing.resolutionMethod = reference.resolutionMethod;
        existing.confidence = reference.confidence;
        existing.resolvedFormula = reference.resolvedFormula;
        existing.isResolved = true;
        existing.active = true;
        existing.resolvedAt = now;
        existing.resolutionMetadata = reference.resolutionMetadata;
        await this.referenceRepository.save(existing);
        return;
      }

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

  private getChapterCandidates(chapter: string | null): string[] {
    if (!chapter) {
      return [];
    }

    const normalized = chapter.padStart(2, '0');
    if (normalized === '00') {
      return ['00'];
    }

    return [normalized, '00'];
  }
}
