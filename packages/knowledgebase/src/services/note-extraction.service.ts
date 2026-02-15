import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenAiService } from '@hts/core';
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

    const sections = this.pdfParserService.extractSections(text);

    if (Object.keys(sections).length === 0) {
      this.logger.warn('No section headers detected; extracting as chapter notes');
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

    if (text.length >= this.largeTextThreshold) {
      const fallbackContent = this.sanitizeFallbackContent(text).slice(0, 2000);
      if (fallbackContent.length >= 80) {
        this.logger.warn(
          `Section ${noteType} is very large (${text.length} chars); using deterministic fallback note`,
        );
        extractedNotes.push({
          ...this.buildFallbackNote('AUTO-1', fallbackContent),
          source: 'deterministic-fallback',
          noteType,
        });
      }
    }

    // Fast path for normal-size HTS text: regex extraction avoids unnecessary LLM calls.
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
      const fallbackContent = this.sanitizeFallbackContent(text).slice(0, 2000);
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
      const noteNumber = typeof note?.number === 'string' ? note.number.trim() : '';
      if (!noteNumber || !note?.content) continue;
      note.number = noteNumber;
      if (typeof note.content === 'string') {
        note.content = note.content.trim();
      }
      const key = `${noteType}:${noteNumber}`;
      const existing = noteMap.get(key);

      if (!existing || (note.content?.length || 0) > (existing.content?.length || 0)) {
        noteMap.set(key, note);
      }
    }

    const savedNotes: HtsNoteEntity[] = [];

    for (const note of noteMap.values()) {
      const extractionSource =
        typeof note.source === 'string' ? note.source : 'llm';
      const entity = this.noteRepository.create({
        documentId,
        chapter,
        noteType,
        noteNumber: note.number,
        title: note.title || null,
        content: note.content,
        scope: note.scope || null,
        year: year ?? new Date().getFullYear(),
        hasRate: Boolean(note.containsRate || note.rateText),
        extractedData: {
          crossReferences: note.crossReferences || [],
          htsCodes: note.htsCodes || [],
        },
        confidence: typeof note.confidence === 'number' ? note.confidence : 0.85,
        metadata: {
          extractedAt: new Date().toISOString(),
          sourceSection: noteType,
          extractionSource,
        },
      });

      const saved = await this.noteRepository.save(entity);
      savedNotes.push(saved);

      if (note.rateText) {
        await this.extractRate(saved.id, note.rateText);
      }

      if (extractionSource === 'llm') {
        try {
          await this.noteEmbeddingGenerationService.generateSingleEmbedding(saved.id);
        } catch (error) {
          this.logger.warn(`Embedding generation failed for note ${saved.id}: ${error.message}`);
        }
      }
    }

    return savedNotes;
  }

  private async extractNotesFromChunk(noteType: string, text: string): Promise<any[]> {
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
                      crossReferences: { type: 'array', items: { type: 'string' } },
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

  private async extractRate(noteId: string, rateText: string): Promise<void> {
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
      const entity = this.rateRepository.create({
        noteId,
        rateText,
        formula: rate.formula,
        rateType: rate.rateType || 'AD_VALOREM',
        variables: Array.isArray(rate.variables)
          ? rate.variables.map((name: string) => ({
              name,
              type: 'number',
            }))
          : null,
        confidence: rate.confidence,
      });

      await this.rateRepository.save(entity);
    } catch (error) {
      this.logger.error(`Rate extraction failed: ${error.message}`);
    }
  }

  private chunkText(text: string, maxLength: number, overlap: number): string[] {
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

    if (candidates.length === 0 && !isLargeText) {
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

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

  private buildFallbackNote(number: string, content: string): any {
    const firstSentence = content.split(/(?<=[.?!])\s+/).find(Boolean) || content;
    const crossReferences = Array.from(
      new Set(
        Array.from(content.matchAll(/note\s+([0-9]+[A-Za-z]?(?:\([a-z0-9]+\))*)/gi)).map(
          (item) => item[1],
        ),
      ),
    );
    const htsCodes = Array.from(
      new Set(
        Array.from(content.matchAll(/\b\d{4}(?:\.\d{2}){0,3}\b/g)).map((item) => item[0]),
      ),
    );

    return {
      number,
      title: firstSentence.slice(0, 120),
      content,
      scope: null,
      containsRate: /(?:\bfree\b|%|\$|ad valorem|specific|duty|cents?)/i.test(content),
      rateText: null,
      confidence: 0.55,
      crossReferences,
      htsCodes,
    };
  }
}
