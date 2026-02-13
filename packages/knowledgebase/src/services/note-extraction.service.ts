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
    const chunks = this.chunkText(text, 12000, 500);
    const noteMap = new Map<string, any>();

    for (const chunk of chunks) {
      const extracted = await this.extractNotesFromChunk(noteType, chunk);
      for (const note of extracted) {
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
    }

    const savedNotes: HtsNoteEntity[] = [];

    for (const note of noteMap.values()) {
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
        },
      });

      const saved = await this.noteRepository.save(entity);
      savedNotes.push(saved);

      if (note.rateText) {
        await this.extractRate(saved.id, note.rateText);
      }

      try {
        await this.noteEmbeddingGenerationService.generateSingleEmbedding(saved.id);
      } catch (error) {
        this.logger.warn(`Embedding generation failed for note ${saved.id}: ${error.message}`);
      }
    }

    return savedNotes;
  }

  private async extractNotesFromChunk(noteType: string, text: string): Promise<any[]> {
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
      const response = await this.openAiService.response(input, {
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
      });

      const outputText = (response as any).output_text || '';
      if (!outputText) {
        throw new Error('OpenAI returned empty response');
      }

      const notes = JSON.parse(outputText);
      return Array.isArray(notes) ? notes : [];
    } catch (error) {
      this.logger.error(`Note extraction failed: ${error.message}`);
      return [];
    }
  }

  private async extractRate(noteId: string, rateText: string): Promise<void> {
    const input = `Convert this rate to a formula: "${rateText}".
Return JSON with: formula, variables, confidence, rateType.`;

    try {
      const response = await this.openAiService.response(input, {
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
      });

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
      start = end - overlap;
      if (start < 0) start = 0;
    }

    return chunks;
  }
}
