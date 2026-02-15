import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '../entities/hts.entity';
import { FormulaGenerationService } from './formula-generation.service';

type FormulaVariable = {
  name: string;
  type: string;
  description?: string;
  unit?: string;
};

type Chapter99SynthesisOptions = {
  sourceVersion?: string;
  activeOnly?: boolean;
  batchSize?: number;
};

export type Chapter99PreviewStatus = 'LINKED' | 'UNRESOLVED' | 'NONE';

export type Chapter99PreviewInput = {
  htsNumber: string;
  chapter: string;
  description?: string | null;
  generalRate?: string | null;
  rateFormula?: string | null;
  footnotes?: string | null;
  chapter99Links?: string[] | null;
  nonNtrApplicableCountries?: string[] | null;
};

export type Chapter99ReferenceInput = {
  htsNumber: string;
  description?: string | null;
  generalRate?: string | null;
  general?: string | null;
  chapter99ApplicableCountries?: string[] | null;
};

export type Chapter99PreviewResult = {
  status: Chapter99PreviewStatus;
  htsNumber: string;
  chapter99Links: string[];
  selectedChapter99: {
    htsNumber: string;
    description: string;
    rateText: string;
    adjustmentRate: number;
    referencesApplicableSubheading: boolean;
  } | null;
  chapter99ApplicableCountries: string[] | null;
  nonNtrApplicableCountries: string[];
  baseFormula: string | null;
  adjustedFormula: string | null;
  adjustedFormulaVariables: FormulaVariable[] | null;
  reason: string | null;
};

@Injectable()
export class HtsChapter99FormulaService {
  private readonly logger = new Logger(HtsChapter99FormulaService.name);
  private readonly defaultNonNtrCountries = ['CU', 'KP', 'RU', 'BY'];
  private readonly chapter99CodePattern = /\b(99\d{2}\.\d{2}\.\d{2}(?:\.\d{2})?)\b/g;
  private readonly countryAliasToIso: Record<string, string> = {
    china: 'CN',
    "people's republic of china": 'CN',
    'peoples republic of china': 'CN',
    'prc': 'CN',
    'russia': 'RU',
    'russian federation': 'RU',
    'belarus': 'BY',
    'north korea': 'KP',
    "democratic people's republic of korea": 'KP',
    'democratic peoples republic of korea': 'KP',
    'dprk': 'KP',
    'cuba': 'CU',
  };

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    private readonly formulaGenerationService: FormulaGenerationService,
  ) {}

  async synthesizeAdjustedFormulas(
    options: Chapter99SynthesisOptions = {},
  ): Promise<{
    processed: number;
    updated: number;
    linked: number;
    unresolved: number;
    nonNtrDefaultsApplied: number;
  }> {
    const batchSize = Math.max(1, options.batchSize ?? 500);
    const baseQuery = this.htsRepository.createQueryBuilder('hts');

    if (options.sourceVersion) {
      baseQuery.andWhere('hts.sourceVersion = :sourceVersion', {
        sourceVersion: options.sourceVersion,
      });
    }
    if (options.activeOnly) {
      baseQuery.andWhere('hts.isActive = true');
    }

    const entries = await baseQuery.getMany();
    const chapter99ByCode = new Map<string, HtsEntity>(
      entries
        .filter((entry) => entry.chapter === '99')
        .map((entry) => [entry.htsNumber, entry]),
    );

    let processed = 0;
    let updated = 0;
    let linked = 0;
    let unresolved = 0;
    let nonNtrDefaultsApplied = 0;
    const toSave: HtsEntity[] = [];

    for (const entry of entries) {
      processed++;
      if (entry.chapter === '99') {
        continue;
      }

      const nextNonNtr = this.normalizeCountryCodes(
        entry.nonNtrApplicableCountries?.length
          ? entry.nonNtrApplicableCountries
          : this.defaultNonNtrCountries,
      );
      let mutated = !this.sameStringArray(
        entry.nonNtrApplicableCountries,
        nextNonNtr,
      );
      if (mutated) {
        nonNtrDefaultsApplied++;
      }

      const chapter99Links = this.extractChapter99Links(entry);
      if (chapter99Links.length === 0) {
        if (!this.sameStringArray(entry.chapter99Links, null)) {
          entry.chapter99Links = null;
          mutated = true;
        }
        if (mutated) {
          entry.nonNtrApplicableCountries = nextNonNtr;
          toSave.push(entry);
        }
        continue;
      }

      linked++;

      const selected = this.selectChapter99Entry(chapter99Links, chapter99ByCode);
      if (!selected) {
        unresolved++;
        entry.chapter99Links = chapter99Links;
        entry.nonNtrApplicableCountries = nextNonNtr;
        const metadata = {
          ...(entry.metadata || {}),
          chapter99Synthesis: {
            unresolved: true,
            reason: 'linked chapter99 heading not found',
            links: chapter99Links,
            generatedAt: new Date().toISOString(),
          },
        };
        if (!this.isDeepEqual(entry.metadata, metadata)) {
          entry.metadata = metadata;
          mutated = true;
        }
        if (mutated) {
          toSave.push(entry);
        }
        continue;
      }

      const chapter99RateText = this.extractChapter99RateText(selected.entry);
      const baseFormulaResult =
        entry.rateFormula ||
        this.formulaGenerationService.generateFormulaByPattern(
          (entry.generalRate || entry.general || '').toString(),
          entry.unitOfQuantity || undefined,
        )?.formula ||
        null;

      if (!baseFormulaResult) {
        unresolved++;
        entry.chapter99Links = chapter99Links;
        entry.nonNtrApplicableCountries = nextNonNtr;
        const metadata = {
          ...(entry.metadata || {}),
          chapter99Synthesis: {
            unresolved: true,
            reason: 'base general formula unavailable',
            links: chapter99Links,
            selectedChapter99: selected.entry.htsNumber,
            generatedAt: new Date().toISOString(),
          },
        };
        if (!this.isDeepEqual(entry.metadata, metadata)) {
          entry.metadata = metadata;
          mutated = true;
        }
        if (mutated) {
          toSave.push(entry);
        }
        continue;
      }

      const chapter99Countries = this.inferApplicableCountries(selected.entry);
      const adjustedFormula = this.buildAdjustedFormula(
        baseFormulaResult,
        selected.adjustmentRate,
        selected.referencesApplicableSubheading,
      );
      const adjustedVariables = this.mergeVariableObjects(
        entry.rateVariables,
        ['value', ...this.extractFormulaVariables(baseFormulaResult)],
      );

      const nextMetadata = {
        ...(entry.metadata || {}),
        chapter99Synthesis: {
          unresolved: false,
          links: chapter99Links,
          selectedChapter99: selected.entry.htsNumber,
          adjustmentRate: selected.adjustmentRate,
          referencesApplicableSubheading: selected.referencesApplicableSubheading,
          generatedAt: new Date().toISOString(),
        },
      };

      if (entry.chapter99 !== chapter99RateText) {
        entry.chapter99 = chapter99RateText;
        mutated = true;
      }
      if (!this.sameStringArray(entry.chapter99Links, chapter99Links)) {
        entry.chapter99Links = chapter99Links;
        mutated = true;
      }
      if (!this.sameStringArray(entry.chapter99ApplicableCountries, chapter99Countries)) {
        entry.chapter99ApplicableCountries = chapter99Countries;
        mutated = true;
      }
      if (!this.sameStringArray(entry.nonNtrApplicableCountries, nextNonNtr)) {
        entry.nonNtrApplicableCountries = nextNonNtr;
        mutated = true;
      }
      if (entry.adjustedFormula !== adjustedFormula) {
        entry.adjustedFormula = adjustedFormula;
        mutated = true;
      }
      if (!this.isDeepEqual(entry.adjustedFormulaVariables, adjustedVariables)) {
        entry.adjustedFormulaVariables = adjustedVariables;
        mutated = true;
      }
      if (!entry.isAdjustedFormulaGenerated) {
        entry.isAdjustedFormulaGenerated = true;
        mutated = true;
      }
      if (!this.isDeepEqual(entry.metadata, nextMetadata)) {
        entry.metadata = nextMetadata;
        mutated = true;
      }

      if (mutated) {
        toSave.push(entry);
      }
    }

    for (let i = 0; i < toSave.length; i += batchSize) {
      const batch = toSave.slice(i, i + batchSize);
      await this.htsRepository.save(batch);
      updated += batch.length;
    }

    this.logger.log(
      `Chapter99 synthesis complete: processed=${processed}, linked=${linked}, updated=${updated}, unresolved=${unresolved}, nonNtrDefaultsApplied=${nonNtrDefaultsApplied}`,
    );

    return {
      processed,
      updated,
      linked,
      unresolved,
      nonNtrDefaultsApplied,
    };
  }

  previewEntry(
    entryInput: Chapter99PreviewInput,
    chapter99Lookup: Map<string, Chapter99ReferenceInput>,
  ): Chapter99PreviewResult {
    const entry = this.toHtsEntity(entryInput);
    const chapter99ByCode = new Map<string, HtsEntity>();
    for (const [code, reference] of chapter99Lookup.entries()) {
      chapter99ByCode.set(code, this.toHtsEntity(reference));
    }

    const chapter99Links = (entryInput.chapter99Links || []).length
      ? this.normalizeChapter99Links(entryInput.chapter99Links || [])
      : this.extractChapter99Links(entry);
    const nonNtrApplicableCountries = this.normalizeCountryCodes(
      (entryInput.nonNtrApplicableCountries || []).length
        ? entryInput.nonNtrApplicableCountries || []
        : this.defaultNonNtrCountries,
    );

    if (chapter99Links.length === 0) {
      return {
        status: 'NONE',
        htsNumber: entryInput.htsNumber,
        chapter99Links,
        selectedChapter99: null,
        chapter99ApplicableCountries: null,
        nonNtrApplicableCountries,
        baseFormula: this.resolveBaseFormula(entryInput),
        adjustedFormula: null,
        adjustedFormulaVariables: null,
        reason: null,
      };
    }

    const selected = this.selectChapter99Entry(chapter99Links, chapter99ByCode);
    if (!selected) {
      return {
        status: 'UNRESOLVED',
        htsNumber: entryInput.htsNumber,
        chapter99Links,
        selectedChapter99: null,
        chapter99ApplicableCountries: null,
        nonNtrApplicableCountries,
        baseFormula: this.resolveBaseFormula(entryInput),
        adjustedFormula: null,
        adjustedFormulaVariables: null,
        reason: 'linked chapter99 heading not found',
      };
    }

    const baseFormula = this.resolveBaseFormula(entryInput);
    if (!baseFormula) {
      return {
        status: 'UNRESOLVED',
        htsNumber: entryInput.htsNumber,
        chapter99Links,
        selectedChapter99: {
          htsNumber: selected.entry.htsNumber,
          description: selected.entry.description || '',
          rateText: this.extractChapter99RateText(selected.entry),
          adjustmentRate: selected.adjustmentRate,
          referencesApplicableSubheading: selected.referencesApplicableSubheading,
        },
        chapter99ApplicableCountries: this.inferApplicableCountries(selected.entry),
        nonNtrApplicableCountries,
        baseFormula: null,
        adjustedFormula: null,
        adjustedFormulaVariables: null,
        reason: 'base general formula unavailable',
      };
    }

    const adjustedFormula = this.buildAdjustedFormula(
      baseFormula,
      selected.adjustmentRate,
      selected.referencesApplicableSubheading,
    );
    const adjustedFormulaVariables = this.mergeVariableObjects(
      null,
      ['value', ...this.extractFormulaVariables(baseFormula)],
    );

    return {
      status: 'LINKED',
      htsNumber: entryInput.htsNumber,
      chapter99Links,
      selectedChapter99: {
        htsNumber: selected.entry.htsNumber,
        description: selected.entry.description || '',
        rateText: this.extractChapter99RateText(selected.entry),
        adjustmentRate: selected.adjustmentRate,
        referencesApplicableSubheading: selected.referencesApplicableSubheading,
      },
      chapter99ApplicableCountries: this.inferApplicableCountries(selected.entry),
      nonNtrApplicableCountries,
      baseFormula,
      adjustedFormula,
      adjustedFormulaVariables,
      reason: null,
    };
  }

  extractChapter99LinksFromFootnotePayload(payload: unknown): string[] {
    const footnotes = this.normalizeFootnotePayload(payload);
    if (!footnotes) {
      return [];
    }
    return this.normalizeChapter99Links(this.extractCodesFromText(footnotes));
  }

  private extractChapter99Links(entry: HtsEntity): string[] {
    const refs = new Set<string>();

    for (const link of entry.chapter99Links || []) {
      if (link && link.startsWith('99')) {
        refs.add(link);
      }
    }

    const footnotePayloads: string[] = [];
    if (entry.footnotes) {
      footnotePayloads.push(entry.footnotes);
    }

    const metadata = entry.metadata || {};
    if (Array.isArray(metadata.sourceFootnotes)) {
      for (const footnote of metadata.sourceFootnotes) {
        if (typeof footnote === 'string') {
          footnotePayloads.push(footnote);
        } else if (footnote && typeof footnote.value === 'string') {
          footnotePayloads.push(footnote.value);
        }
      }
    }

    for (const payload of footnotePayloads) {
      for (const code of this.extractCodesFromText(payload)) {
        if (code.startsWith('99')) {
          refs.add(code);
        }
      }
    }

    return Array.from(refs).sort();
  }

  private extractCodesFromText(value: string): string[] {
    if (!value) {
      return [];
    }

    const collected: string[] = [];
    const texts: string[] = [value];
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === 'string') {
              texts.push(item);
            } else if (item && typeof item.value === 'string') {
              texts.push(item.value);
            }
          }
        }
      } catch {
        // ignore malformed JSON and keep raw string parsing
      }
    }

    for (const text of texts) {
      for (const match of text.matchAll(this.chapter99CodePattern)) {
        collected.push(match[1]);
      }
    }

    return collected;
  }

  private selectChapter99Entry(
    links: string[],
    chapter99ByCode: Map<string, HtsEntity>,
  ):
    | {
        entry: HtsEntity;
        adjustmentRate: number;
        referencesApplicableSubheading: boolean;
      }
    | null {
    for (const link of links) {
      const entry = chapter99ByCode.get(link);
      if (!entry) {
        continue;
      }
      const parsed = this.parseChapter99Adjustment(entry);
      if (parsed.referencesApplicableSubheading) {
        return {
          entry,
          adjustmentRate: parsed.adjustmentRate,
          referencesApplicableSubheading: true,
        };
      }
    }

    for (const link of links) {
      const entry = chapter99ByCode.get(link);
      if (!entry) {
        continue;
      }
      const parsed = this.parseChapter99Adjustment(entry);
      if (parsed.adjustmentRate > 0) {
        return {
          entry,
          adjustmentRate: parsed.adjustmentRate,
          referencesApplicableSubheading: false,
        };
      }
    }

    return null;
  }

  private parseChapter99Adjustment(entry: HtsEntity): {
    adjustmentRate: number;
    referencesApplicableSubheading: boolean;
  } {
    const rateText = this.extractChapter99RateText(entry);
    const normalized = rateText.toLowerCase();
    const referencesApplicableSubheading = /duty provided in the applicable subheading/.test(
      normalized,
    );

    const plusPercent = rateText.match(/(?:\+|plus)\s*(\d+(?:\.\d+)?)\s*%/i);
    if (plusPercent) {
      return {
        adjustmentRate: parseFloat(plusPercent[1]) / 100,
        referencesApplicableSubheading,
      };
    }

    const deterministic = this.formulaGenerationService.generateFormulaByPattern(rateText);
    if (deterministic && deterministic.variables.length === 1 && deterministic.variables[0] === 'value') {
      const multiplier = deterministic.formula.match(/value\s*\*\s*([0-9.]+)/i);
      if (multiplier) {
        return {
          adjustmentRate: parseFloat(multiplier[1]),
          referencesApplicableSubheading,
        };
      }
    }

    return {
      adjustmentRate: 0,
      referencesApplicableSubheading,
    };
  }

  private extractChapter99RateText(entry: HtsEntity): string {
    return (
      (entry.generalRate || entry.general || entry.chapter99 || '').toString().trim() || ''
    );
  }

  private buildAdjustedFormula(
    baseFormula: string,
    adjustmentRate: number,
    referencesApplicableSubheading: boolean,
  ): string {
    const base = baseFormula.trim();
    if (!base) {
      return '0';
    }

    if (adjustmentRate <= 0) {
      return referencesApplicableSubheading ? base : base;
    }

    return `(${base}) + (value * ${adjustmentRate})`;
  }

  private inferApplicableCountries(entry: HtsEntity): string[] | null {
    const candidates = new Set<string>();

    for (const country of entry.chapter99ApplicableCountries || []) {
      if (country) {
        candidates.add(country.toUpperCase());
      }
    }

    const description = (entry.description || '').toString();
    const phraseMatches = [
      ...description.matchAll(
        /\b(?:product|products|articles)\s+(?:the\s+)?product\s+of\s+([^,.;]+)/gi,
      ),
      ...description.matchAll(/\bproduct\s+of\s+([^,.;]+)/gi),
    ];

    for (const match of phraseMatches) {
      const phrase = (match[1] || '').trim();
      if (!phrase) {
        continue;
      }
      for (const token of phrase.split(/,| and | or /gi)) {
        const normalized = token
          .toLowerCase()
          .replace(/[^\w\s']/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!normalized) {
          continue;
        }
        const iso = this.countryAliasToIso[normalized];
        if (iso) {
          candidates.add(iso);
        }
      }
    }

    return candidates.size > 0 ? Array.from(candidates).sort() : null;
  }

  private extractFormulaVariables(formula: string): string[] {
    return this.formulaGenerationService.validateFormula(formula).variables || [];
  }

  private resolveBaseFormula(entry: Chapter99PreviewInput): string | null {
    if (entry.rateFormula && entry.rateFormula.trim()) {
      return entry.rateFormula.trim();
    }

    const rateText = (entry.generalRate || '').toString().trim();
    if (!rateText) {
      return null;
    }

    const generated = this.formulaGenerationService.generateFormulaByPattern(rateText);
    return generated?.formula || null;
  }

  private mergeVariableObjects(
    existing: FormulaVariable[] | null | undefined,
    variableNames: string[],
  ): FormulaVariable[] {
    const seen = new Set<string>();
    const merged: FormulaVariable[] = [];

    for (const variable of existing || []) {
      if (!variable?.name || seen.has(variable.name)) {
        continue;
      }
      seen.add(variable.name);
      merged.push(variable);
    }

    for (const name of variableNames) {
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      merged.push({
        name,
        type: 'number',
        description: this.describeVariable(name),
      });
    }

    return merged;
  }

  private describeVariable(name: string): string {
    if (name === 'value') {
      return 'Declared value of goods in USD';
    }
    if (name === 'weight') {
      return 'Weight of goods in kilograms';
    }
    if (name === 'quantity') {
      return 'Number of imported items';
    }
    return 'Input variable';
  }

  private normalizeFootnotePayload(payload: unknown): string | null {
    if (!payload) {
      return null;
    }
    if (typeof payload === 'string') {
      const value = payload.trim();
      return value.length > 0 ? value : null;
    }
    if (Array.isArray(payload)) {
      const chunks = payload
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof (item as any).value === 'string') return (item as any).value;
          return '';
        })
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

      if (chunks.length > 0) {
        return chunks.join(' ');
      }

      return JSON.stringify(payload);
    }
    return JSON.stringify(payload);
  }

  private normalizeChapter99Links(links: string[]): string[] {
    return Array.from(
      new Set(
        (links || [])
          .map((item) => (item || '').trim())
          .filter((item) => /^99\d{2}\.\d{2}\.\d{2}(?:\.\d{2})?$/.test(item)),
      ),
    ).sort();
  }

  private toHtsEntity(value: Partial<HtsEntity> | Record<string, any>): HtsEntity {
    return value as HtsEntity;
  }

  private normalizeCountryCodes(codes: string[]): string[] {
    return Array.from(
      new Set(
        codes
          .map((code) => (code || '').toUpperCase().trim())
          .filter((code) => code.length >= 2),
      ),
    ).sort();
  }

  private sameStringArray(
    left: string[] | null | undefined,
    right: string[] | null | undefined,
  ): boolean {
    const normalizedLeft = (left || []).slice().sort();
    const normalizedRight = (right || []).slice().sort();
    return this.isDeepEqual(normalizedLeft, normalizedRight);
  }

  private isDeepEqual(left: any, right: any): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }
}
