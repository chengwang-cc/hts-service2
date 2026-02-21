import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenAiService, FormulaGenerationService } from '@hts/core';
import { HtsNoteEntity, HtsNoteRateEntity } from '../entities';
import { PdfParserService } from './pdf-parser.service';
import { NoteEmbeddingGenerationService } from './note-embedding-generation.service';

const SECTION_TYPE_MAP: Record<string, string> = {
  'GENERAL NOTES': 'GENERAL_NOTE',
  'ADDITIONAL U.S. NOTES': 'ADDITIONAL_US_NOTE',
  'STATISTICAL NOTES': 'STATISTICAL_NOTE',
  'SECTION NOTES': 'SECTION_NOTE',
  'CHAPTER NOTES': 'CHAPTER_NOTE',
};

@Injectable()
export class NoteExtractionService {
  private readonly logger = new Logger(NoteExtractionService.name);
  private readonly maxAiExtractionChunks = 5;
  private readonly maxRegexFallbackNotes = 200;
  private readonly largeTextThreshold = 1_000_000;
  private readonly openAiTimeoutMs = 8_000;

  constructor(
    private readonly openAiService: OpenAiService,
    private readonly formulaGenerationService: FormulaGenerationService,
    private readonly pdfParserService: PdfParserService,
    private readonly noteEmbeddingGenerationService: NoteEmbeddingGenerationService,
    @InjectRepository(HtsNoteEntity)
    private readonly noteRepository: Repository<HtsNoteEntity>,
    @InjectRepository(HtsNoteRateEntity)
    private readonly rateRepository: Repository<HtsNoteRateEntity>,
  ) {}

  async extractNotes(
    documentId: string,
    chapter: string,
    text: string,
    year?: number,
  ): Promise<HtsNoteEntity[]> {
    // Idempotency: replace notes for the same document on retries/reprocessing
    await this.noteRepository.delete({ documentId });

    if (text.length >= this.largeTextThreshold) {
      this.logger.warn(
        `Document ${documentId} text is very large (${text.length} chars); skipping section parsing`,
      );
      return this.extractNotesFromSection(
        documentId,
        chapter,
        year,
        'CHAPTER_NOTE',
        text,
      );
    }

    const sections = this.pdfParserService.extractSections(text);

    if (Object.keys(sections).length === 0) {
      this.logger.warn(
        'No section headers detected; extracting as chapter notes',
      );
      return this.extractNotesFromSection(
        documentId,
        chapter,
        year,
        'CHAPTER_NOTE',
        text,
      );
    }

    const results: HtsNoteEntity[] = [];

    for (const [sectionName, sectionText] of Object.entries(sections)) {
      const noteType = SECTION_TYPE_MAP[sectionName] || 'CHAPTER_NOTE';
      const extracted = await this.extractNotesFromSection(
        documentId,
        chapter,
        year,
        noteType,
        sectionText,
      );
      results.push(...extracted);
    }

    return results;
  }

  private async extractNotesFromSection(
    documentId: string,
    chapter: string,
    year: number | undefined,
    noteType: string,
    text: string,
  ): Promise<HtsNoteEntity[]> {
    let extractedNotes: any[] = [];

    // Fast path for normal-size HTS text: regex extraction avoids unnecessary LLM calls.
    if (text.length >= this.largeTextThreshold) {
      this.logger.warn(
        `Section ${noteType} is very large (${text.length} chars); using regex-only extraction`,
      );
    }

    if (extractedNotes.length === 0) {
      extractedNotes = this.extractNotesByRegex(noteType, text);
    }
    if (extractedNotes.length > 0) {
      this.logger.log(
        `Regex extracted ${extractedNotes.length} ${noteType} notes; skipping LLM extraction`,
      );
    }

    if (extractedNotes.length === 0) {
      const chunks = this.chunkText(text, 12000, 500);
      const chunkLimit = Math.min(chunks.length, this.maxAiExtractionChunks);
      if (chunks.length > chunkLimit) {
        this.logger.warn(
          `Section ${noteType} has ${chunks.length} chunks; limiting LLM extraction to ${chunkLimit} chunks`,
        );
      }

      for (const chunk of chunks.slice(0, chunkLimit)) {
        const extracted = await this.extractNotesFromChunk(noteType, chunk);
        extractedNotes.push(...extracted);
      }
    }

    if (extractedNotes.length === 0) {
      const fallbackContent = this.sanitizeFallbackContent(
        text.slice(0, 4000),
      ).slice(0, 2000);
      if (fallbackContent.length >= 80) {
        this.logger.warn(
          `No structured notes extracted for ${noteType}; creating deterministic fallback note`,
        );
        extractedNotes.push({
          ...this.buildFallbackNote('AUTO-1', fallbackContent),
          source: 'deterministic-fallback',
          noteType,
        });
      }
    }

    const noteMap = new Map<string, any>();

    for (const note of extractedNotes) {
      const noteNumber =
        typeof note?.number === 'string' ? note.number.trim() : '';
      if (!noteNumber || !note?.content) continue;
      note.number = noteNumber;
      if (typeof note.content === 'string') {
        note.content = this.trimNoteContent(note.content.trim());
      }
      const key = `${noteType}:${noteNumber}`;
      const existing = noteMap.get(key);
      const existingScore = existing
        ? this.scoreExtractedNote(existing)
        : Number.NEGATIVE_INFINITY;
      const candidateScore = this.scoreExtractedNote(note);

      if (
        !existing ||
        candidateScore > existingScore ||
        (candidateScore === existingScore &&
          (note.content?.length || 0) > (existing.content?.length || 0))
      ) {
        noteMap.set(key, note);
      }
    }

    const savedNotes: HtsNoteEntity[] = [];

    for (const note of noteMap.values()) {
      const extractionSource =
        typeof note.source === 'string' ? note.source : 'llm';
      const explicitRateText =
        typeof note?.rateText === 'string' ? note.rateText.trim() : '';
      const derivedRateCandidates = this.getRateCandidates(note);
      const noteYear = year ?? new Date().getFullYear();
      const hasRate =
        explicitRateText.length > 0 ||
        derivedRateCandidates.length > 0 ||
        Boolean(note.containsRate || note.rateText);

      const saved = await this.upsertNote({
        documentId,
        chapter,
        noteType,
        noteNumber: note.number,
        title: note.title || null,
        content: note.content,
        scope: note.scope || null,
        year: noteYear,
        hasRate,
        extractedData: {
          crossReferences: note.crossReferences || [],
          htsCodes: note.htsCodes || [],
        },
        confidence:
          typeof note.confidence === 'number' ? note.confidence : 0.85,
        metadata: {
          extractedAt: new Date().toISOString(),
          sourceSection: noteType,
          extractionSource,
        },
      });
      savedNotes.push(saved);

      // Replace rate rows for this note key to avoid stale formulas after re-import.
      await this.rateRepository.delete({ noteId: saved.id });

      if (explicitRateText.length > 0) {
        await this.extractRate(saved.id, explicitRateText, note.rateType, true);
      }

      for (const rateCandidate of derivedRateCandidates) {
        if (rateCandidate === explicitRateText) {
          continue;
        }
        await this.extractRate(saved.id, rateCandidate, note.rateType, false);
      }

      try {
        await this.noteEmbeddingGenerationService.generateSingleEmbedding(
          saved.id,
        );
      } catch (error) {
        this.logger.warn(
          `Embedding generation failed for note ${saved.id}: ${error.message}`,
        );
      }
    }

    return savedNotes;
  }

  private async upsertNote(payload: {
    documentId: string;
    chapter: string;
    noteType: string;
    noteNumber: string;
    title: string | null;
    content: string;
    scope: string | null;
    year: number;
    hasRate: boolean;
    extractedData: Record<string, any> | null;
    confidence: number | null;
    metadata: Record<string, any> | null;
  }): Promise<HtsNoteEntity> {
    const existingRows = await this.noteRepository
      .createQueryBuilder('note')
      .where('note.year = :year', { year: payload.year })
      .andWhere('note.chapter = :chapter', { chapter: payload.chapter })
      .andWhere('note.type = :noteType', { noteType: payload.noteType })
      .andWhere('note.note_number = :noteNumber', {
        noteNumber: payload.noteNumber,
      })
      .orderBy('note.updated_at', 'DESC')
      .addOrderBy('note.created_at', 'DESC')
      .getMany();

    let entity: HtsNoteEntity;
    if (existingRows.length > 0) {
      entity = existingRows[0];

      if (existingRows.length > 1) {
        const duplicateIds = existingRows.slice(1).map((item) => item.id);
        await this.noteRepository.delete(duplicateIds);
      }
    } else {
      entity = this.noteRepository.create();
    }

    entity.documentId = payload.documentId;
    entity.chapter = payload.chapter;
    entity.noteType = payload.noteType;
    entity.noteNumber = payload.noteNumber;
    entity.title = payload.title;
    entity.content = payload.content;
    entity.scope = payload.scope;
    entity.year = payload.year;
    entity.hasRate = payload.hasRate;
    entity.extractedData = payload.extractedData;
    entity.confidence = payload.confidence;
    entity.metadata = payload.metadata;

    return this.noteRepository.save(entity);
  }

  private async extractNotesFromChunk(
    noteType: string,
    text: string,
  ): Promise<any[]> {
    const fallbackNotes = this.extractNotesByRegex(noteType, text);
    const input = `Extract all HTS notes from the following section text.
Section type: ${noteType}

Return JSON array with fields:
- number
- title
- content
- scope
- containsRate (boolean)
- rateText
- rateType
- confidence (0-1)
- crossReferences (array of strings)
- htsCodes (array of strings)

Text:
${text}`;

    try {
      const response = await this.withTimeout(
        this.openAiService.response(input, {
          model: 'gpt-4o',
          instructions: 'You are an expert at extracting structured HTS notes.',
          temperature: 0,
          store: false,
          text: {
            format: {
              type: 'json_schema',
              json_schema: {
                name: 'notes_response',
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      number: { type: 'string' },
                      title: { type: 'string' },
                      content: { type: 'string' },
                      scope: { type: 'string' },
                      containsRate: { type: 'boolean' },
                      rateText: { type: 'string' },
                      rateType: { type: 'string' },
                      confidence: { type: 'number' },
                      crossReferences: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                      htsCodes: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['number', 'content'],
                    additionalProperties: false,
                  },
                },
                strict: true,
              },
            },
          },
        }),
        this.openAiTimeoutMs,
        'Note extraction OpenAI timeout',
      );

      const outputText = (response as any).output_text || '';
      if (!outputText) {
        throw new Error('OpenAI returned empty response');
      }

      const notes = JSON.parse(outputText);
      if (Array.isArray(notes) && notes.length > 0) {
        return notes;
      }

      if (fallbackNotes.length > 0) {
        this.logger.warn(
          `OpenAI returned no notes for ${noteType}; using regex fallback (${fallbackNotes.length} notes)`,
        );
        return fallbackNotes;
      }

      return [];
    } catch (error) {
      this.logger.error(`Note extraction failed: ${error.message}`);
      if (fallbackNotes.length > 0) {
        this.logger.warn(
          `Using regex fallback for ${noteType} after extraction failure (${fallbackNotes.length} notes)`,
        );
        return fallbackNotes;
      }
      return [];
    }
  }

  private async extractRate(
    noteId: string,
    rateText: string,
    declaredRateType?: string,
    allowAiFallback: boolean = false,
  ): Promise<void> {
    const deterministic =
      this.formulaGenerationService.generateFormulaByPattern(rateText);

    if (deterministic) {
      const existing = await this.rateRepository.findOne({
        where: { noteId, rateText },
      });
      if (existing) {
        return;
      }

      const entity = this.rateRepository.create({
        noteId,
        rateText,
        formula: deterministic.formula,
        rateType: declaredRateType || this.classifyRateType(rateText),
        variables: deterministic.variables.map((name: string) => ({
          name,
          type: 'number',
        })),
        confidence: deterministic.confidence,
        metadata: {
          source: 'pattern',
          generatedAt: new Date().toISOString(),
        },
      });

      await this.rateRepository.save(entity);
      return;
    }

    if (!allowAiFallback) {
      return;
    }

    const input = `Convert this rate to a formula: "${rateText}".
Return JSON with: formula, variables, confidence, rateType.`;

    try {
      const response = await this.withTimeout(
        this.openAiService.response(input, {
          model: 'gpt-4o',
          instructions: 'Convert tariff rates to mathematical formulas.',
          temperature: 0,
          store: false,
          text: {
            format: {
              type: 'json_schema',
              json_schema: {
                name: 'rate_response',
                schema: {
                  type: 'object',
                  properties: {
                    formula: { type: 'string' },
                    variables: { type: 'array', items: { type: 'string' } },
                    confidence: { type: 'number' },
                    rateType: { type: 'string' },
                  },
                  required: ['formula', 'variables', 'confidence'],
                  additionalProperties: false,
                },
                strict: true,
              },
            },
          },
        }),
        this.openAiTimeoutMs,
        'Rate extraction OpenAI timeout',
      );

      const outputText = (response as any).output_text || '';
      if (!outputText) {
        throw new Error('OpenAI returned empty response');
      }

      const rate = JSON.parse(outputText);
      const existing = await this.rateRepository.findOne({
        where: { noteId, rateText },
      });
      if (existing) {
        return;
      }
      const entity = this.rateRepository.create({
        noteId,
        rateText,
        formula: rate.formula,
        rateType:
          rate.rateType || declaredRateType || this.classifyRateType(rateText),
        variables: Array.isArray(rate.variables)
          ? rate.variables.map((name: string) => ({
              name,
              type: 'number',
            }))
          : null,
        confidence: rate.confidence,
        metadata: {
          source: 'llm',
          generatedAt: new Date().toISOString(),
        },
      });

      await this.rateRepository.save(entity);
    } catch (error) {
      this.logger.error(`Rate extraction failed: ${error.message}`);
    }
  }

  private chunkText(
    text: string,
    maxLength: number,
    overlap: number,
  ): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(text.length, start + maxLength);
      chunks.push(text.substring(start, end));
      if (end >= text.length) {
        break;
      }

      const nextStart = end - overlap;
      start = nextStart > start ? nextStart : end;
    }

    return chunks;
  }

  private extractNotesByRegex(noteType: string, text: string): any[] {
    const candidates: any[] = [];
    const normalizedText = (text || '').replace(/\r/g, '');
    const isLargeText = normalizedText.length >= this.largeTextThreshold;

    const explicitNoteRegex =
      /(?:^|\n)\s*(?:[A-Z][A-Z\s.\-]{0,30}\s+)?NOTE\s+([0-9]+[A-Za-z]?(?:\([a-z0-9]+\))*)[.: -]*([\s\S]*?)(?=\n\s*(?:[A-Z][A-Z\s.\-]{0,30}\s+)?NOTE\s+[0-9]+[A-Za-z]?(?:\([a-z0-9]+\))*[.: -]*|$)/gi;
    for (const match of normalizedText.matchAll(explicitNoteRegex)) {
      const number = (match[1] || '').trim();
      const content = this.sanitizeFallbackContent(match[2] || '');
      if (!number || content.length < 30) continue;
      candidates.push(this.buildFallbackNote(number, content));
    }

    if (!isLargeText) {
      const numberedRegex =
        /(?:^|\n)\s*([0-9]+[A-Za-z]?(?:\([a-z0-9]+\))*)\.\s+([\s\S]*?)(?=\n\s*[0-9]+[A-Za-z]?(?:\([a-z0-9]+\))*\.\s+|$)/g;
      for (const match of normalizedText.matchAll(numberedRegex)) {
        const number = (match[1] || '').trim();
        const content = this.sanitizeFallbackContent(match[2] || '');
        if (!number || content.length < 50) continue;
        candidates.push(this.buildFallbackNote(number, content));
      }
    } else if (candidates.length === 0 && isLargeText) {
      this.logger.warn(
        `Skipping generic numbered fallback for ${noteType}; text size ${normalizedText.length} is too large`,
      );
    }

    const limitedCandidates = candidates.slice(0, this.maxRegexFallbackNotes);
    if (candidates.length > limitedCandidates.length) {
      this.logger.warn(
        `Regex fallback produced ${candidates.length} notes for ${noteType}; limiting to ${limitedCandidates.length}`,
      );
    }

    return limitedCandidates.map((note) => ({
      ...note,
      source: 'regex-fallback',
      noteType,
    }));
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private sanitizeFallbackContent(content: string): string {
    return content
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  private trimNoteContent(content: string): string {
    let normalized = this.sanitizeFallbackContent(content);

    const trailingMarkers = [
      /harmonized tariff schedule of the united states/i,
      /annotated for statistical reporting purposes/i,
      /\n\s*heading\/\s*stat\./i,
      /\n\s*heading\/\s*subheading/i,
    ];

    for (const marker of trailingMarkers) {
      const match = normalized.match(marker);
      if (match?.index && match.index > 120) {
        normalized = normalized.slice(0, match.index).trim();
      }
    }

    return normalized;
  }

  private scoreExtractedNote(note: any): number {
    const content = typeof note?.content === 'string' ? note.content : '';
    const length = content.length;
    let score = 0;

    if (/the rates of duty applicable to subheading/i.test(content)) {
      score += 50;
    }
    if (/column\s+1\s*\(general\)/i.test(content)) {
      score += 20;
    }
    if (/column\s+2/i.test(content)) {
      score += 10;
    }
    if (/\.{4,}/.test(content)) {
      score -= 15;
    }
    if (/harmonized tariff schedule of the united states/i.test(content)) {
      score -= 20;
    }
    if (/annotated for statistical reporting purposes/i.test(content)) {
      score -= 20;
    }
    if (
      /u\.s\.\s*note\s+\d+/i.test(content) &&
      !/the rates of duty applicable to subheading/i.test(content)
    ) {
      score -= 10;
    }

    if (length < 80) {
      score -= 40;
    } else if (length <= 2500) {
      score += 20;
    } else if (length <= 5000) {
      score += 5;
    } else {
      score -= 30;
    }

    return score;
  }

  private buildFallbackNote(number: string, content: string): any {
    const firstSentence =
      content.split(/(?<=[.?!])\s+/).find(Boolean) || content;
    const crossReferences = Array.from(
      new Set(
        Array.from(
          content.matchAll(/note\s+([0-9]+[A-Za-z]?(?:\([a-z0-9]+\))*)/gi),
        ).map((item) => item[1]),
      ),
    );
    const htsCodes = Array.from(
      new Set(
        Array.from(content.matchAll(/\b\d{4}(?:\.\d{2}){0,3}\b/g)).map(
          (item) => item[0],
        ),
      ),
    );

    return {
      number,
      title: firstSentence.slice(0, 120),
      content,
      scope: null,
      containsRate: /(?:\bfree\b|%|\$|ad valorem|specific|duty|cents?)/i.test(
        content,
      ),
      rateText: null,
      confidence: 0.55,
      crossReferences,
      htsCodes,
    };
  }

  private getRateCandidates(note: any): string[] {
    const candidates: string[] = [];
    const content = typeof note?.content === 'string' ? note.content : '';
    if (content.length > 0) {
      candidates.push(...this.extractRateCandidatesFromContent(content));
    }

    return Array.from(
      new Set(candidates.map((entry) => entry.trim()).filter(Boolean)),
    ).slice(0, 5);
  }

  private extractRateCandidatesFromContent(content: string): string[] {
    const normalized = content.replace(/\s+/g, ' ');
    const patterns = [
      /\b\d+(?:\.\d+)?\s*%\s*\+\s*(?:\$|¢)?\s*\d+(?:\.\d+)?\s*(?:¢|cents?)?\s*(?:\/|per)\s*[A-Za-z.]+/gi,
      /(?:\$|¢)?\s*\d+(?:\.\d+)?\s*(?:¢|cents?)?\s*(?:\/|per)\s*[A-Za-z.]+\s*\+\s*\d+(?:\.\d+)?\s*%/gi,
      /(?:\$|¢)?\s*\d+(?:\.\d+)?\s*(?:¢|cents?)?\s*(?:\/|per)\s*[A-Za-z.]+/gi,
      /\b\d+(?:\.\d+)?\s*(?:%|percent|per cent)(?:\s+ad valorem)?/gi,
      /\bfree\b/gi,
    ];

    const found: string[] = [];
    for (const pattern of patterns) {
      for (const match of normalized.matchAll(pattern)) {
        const value = (match[0] || '').trim();
        if (value.length >= 3 && value.length <= 120) {
          found.push(value);
        }
      }
    }

    return found.slice(0, 5);
  }

  private classifyRateType(rateText: string): string {
    const normalized = rateText.toLowerCase();
    const hasPercent = /%|percent|per cent/.test(normalized);
    const hasSpecific =
      /\$|¢|cents?|\/|\bper\s+(kg|g|lb|lbs|unit|units|each|item|items|doz|dozen|liter|liters|l|ml|m|meter|meters|sqm|sqft|ton|tons)\b/.test(
        normalized,
      );

    if (hasPercent && hasSpecific) {
      return 'COMPOUND';
    }
    if (hasPercent) {
      return 'AD_VALOREM';
    }
    if (hasSpecific) {
      return 'SPECIFIC';
    }
    return 'OTHER';
  }
}
