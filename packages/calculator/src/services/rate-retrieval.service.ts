import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  HtsEntity,
  FormulaGenerationService,
  HtsFormulaUpdateService,
  HtsTariffHistory2025Entity,
} from '@hts/core';
import { NoteResolutionService } from '@hts/knowledgebase';

type RateLookupContext = {
  entryDate?: string;
  selectedChapter99Headings?: string[];
};

@Injectable()
export class RateRetrievalService {
  private readonly logger = new Logger(RateRetrievalService.name);
  private readonly historyFallbackCutoff = new Date(Date.UTC(2025, 11, 31));

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    @InjectRepository(HtsTariffHistory2025Entity)
    private readonly tariffHistory2025Repository: Repository<HtsTariffHistory2025Entity>,
    private readonly formulaGenerationService: FormulaGenerationService,
    private readonly formulaUpdateService: HtsFormulaUpdateService,
    @Optional() private readonly noteResolutionService?: NoteResolutionService,
  ) {
    if (this.noteResolutionService) {
      this.logger.log('Knowledgebase integration enabled for rate retrieval');
    } else {
      this.logger.log(
        'Running without knowledgebase - using fallback strategy',
      );
    }
  }

  async getRate(
    htsNumber: string,
    countryOfOrigin: string,
    version?: string,
    context: RateLookupContext = {},
  ): Promise<{
    formula: string;
    source: 'manual' | 'knowledgebase' | 'general' | 'other' | 'adjusted';
    confidence: number;
    overrideExtraTax?: boolean;
    formulaType?: string;
    variables?: Array<{
      name: string;
      type: string;
      description?: string;
      unit?: string;
    }> | null;
  }> {
    const normalizedCountry = countryOfOrigin.toUpperCase();

    // Load HTS entry to determine version and base formulas
    const htsEntry = await this.loadBestMatchingEntry(htsNumber, version);

    if (!htsEntry) {
      throw new Error(`HTS code ${htsNumber} not found`);
    }

    const resolvedVersion =
      version || (htsEntry as any).version || htsEntry.sourceVersion || null;

    const nonNtrCountries = this.resolveNonNtrCountries(htsEntry);
    const isNonNTR = nonNtrCountries.includes(normalizedCountry);
    const chapter99Countries = (
      htsEntry.chapter99ApplicableCountries || []
    ).map((code) => code.toUpperCase());
    const chapter99Links = this.normalizeChapter99Headings(
      htsEntry.chapter99Links || [],
    );
    const selectedChapter99Headings = this.normalizeChapter99Headings(
      context.selectedChapter99Headings || [],
    );
    const hasExplicitChapter99Selection = selectedChapter99Headings.some(
      (heading) => chapter99Links.includes(heading),
    );
    const chapter99SynthesisMetadata =
      (htsEntry.metadata as Record<string, any> | null | undefined)
        ?.chapter99Synthesis || null;
    const reciprocalOnlyChapter99 =
      !!chapter99SynthesisMetadata?.reciprocalOnly;
    const hasChapter99Signals =
      chapter99Links.length > 0 ||
      !!(htsEntry.chapter99 && htsEntry.chapter99.trim());
    const chapter99CountryEligible =
      chapter99Countries.length === 0 ||
      chapter99Countries.includes(normalizedCountry);
    const chapter99Eligible =
      !isNonNTR &&
      !reciprocalOnlyChapter99 &&
      hasChapter99Signals &&
      hasExplicitChapter99Selection &&
      chapter99CountryEligible;
    const chapter99Applies = chapter99Eligible && !!htsEntry.adjustedFormula;
    const otherChapter99Applies =
      isNonNTR &&
      !!htsEntry.otherChapter99Detail?.formula &&
      (!htsEntry.otherChapter99Detail?.countries ||
        htsEntry.otherChapter99Detail.countries.length === 0 ||
        htsEntry.otherChapter99Detail.countries
          .map((code) => code.toUpperCase())
          .includes(normalizedCountry));

    const desiredFormulaType = otherChapter99Applies
      ? 'OTHER_CHAPTER99'
      : isNonNTR
        ? 'OTHER'
        : chapter99Eligible
          ? 'ADJUSTED'
          : 'GENERAL';

    // Priority 1: Manual override (version + country + type aware)
    for (const formulaType of this.getManualFormulaLookupOrder(
      desiredFormulaType,
    )) {
      const manualOverride = await this.formulaUpdateService.findUpdatedFormula(
        {
          htsNumber,
          countryCode: normalizedCountry,
          formulaType,
          version: resolvedVersion,
        },
      );

      if (manualOverride) {
        this.logger.debug(
          `Using manual override for ${htsNumber} (${formulaType})`,
        );
        return {
          formula: manualOverride.formula,
          source: 'manual',
          confidence: 1.0,
          overrideExtraTax: manualOverride.overrideExtraTax,
          formulaType: manualOverride.formulaType,
          variables: manualOverride.formulaVariables ?? null,
        };
      }
    }

    // Priority 1b: For Chapter 99 requests dated in/through 2025, prefer historical 2025 rates.
    if (htsNumber.startsWith('99')) {
      const historicalChapter99Formula =
        await this.resolveHistorical2025Formula(htsNumber, context.entryDate);
      if (historicalChapter99Formula) {
        this.logger.debug(`Using 2025 chapter99 fallback for ${htsNumber}`);
        return {
          formula: historicalChapter99Formula.formula,
          source: 'general',
          confidence: historicalChapter99Formula.confidence,
          formulaType: 'GENERAL',
          variables: historicalChapter99Formula.variables,
        };
      }
    }

    // Priority 2: Standard HTS formulas
    if (otherChapter99Applies && htsEntry.otherChapter99Detail?.formula) {
      this.logger.debug(`Using non-NTR + Chapter99 formula for ${htsNumber}`);
      return {
        formula: htsEntry.otherChapter99Detail.formula,
        source: 'other',
        confidence: 0.95,
        formulaType: 'OTHER_CHAPTER99',
        variables: htsEntry.otherChapter99Detail.variables || null,
      };
    }

    if (isNonNTR && htsEntry.otherRateFormula) {
      this.logger.debug(`Using non-NTR formula for ${htsNumber}`);
      return {
        formula: htsEntry.otherRateFormula,
        source: 'other',
        confidence: 0.9,
        formulaType: 'OTHER',
        variables: htsEntry.otherRateVariables || null,
      };
    }

    if (chapter99Applies && htsEntry.adjustedFormula) {
      this.logger.debug(`Using Chapter99 adjusted formula for ${htsNumber}`);
      return {
        formula: htsEntry.adjustedFormula,
        source: 'adjusted',
        confidence: 0.95,
        formulaType: 'ADJUSTED',
        variables: htsEntry.adjustedFormulaVariables || null,
      };
    }

    if (htsEntry.rateFormula) {
      this.logger.debug(`Using general formula for ${htsNumber}`);
      return {
        formula: htsEntry.rateFormula,
        source: 'general',
        confidence: 0.9,
        formulaType: 'GENERAL',
        variables: htsEntry.rateVariables || null,
      };
    }

    const deterministicGeneralFormula =
      this.resolveDeterministicGeneralFormula(htsEntry);
    if (deterministicGeneralFormula) {
      this.logger.debug(
        `Using deterministic general-rate fallback for ${htsNumber}`,
      );
      return deterministicGeneralFormula;
    }

    const inferredBaseFormula = this.inferBaseFormulaFromAdjusted(htsEntry);
    if (inferredBaseFormula) {
      this.logger.debug(
        `Using inferred base formula from adjusted formula for ${htsNumber}`,
      );
      return {
        formula: inferredBaseFormula,
        source: 'general',
        confidence: 0.75,
        formulaType: 'GENERAL',
        variables: htsEntry.rateVariables || null,
      };
    }

    // Priority 3: Knowledgebase resolution (if available)
    if (this.noteResolutionService) {
      try {
        const rateText = isNonNTR ? htsEntry.otherRate : htsEntry.generalRate;
        if (rateText && /note/i.test(rateText)) {
          const inferredYear = this.extractYear(resolvedVersion);
          const kbResolution =
            await this.noteResolutionService.resolveNoteReference(
              htsNumber,
              rateText,
              isNonNTR ? 'other' : 'general',
              inferredYear,
            );

          if (kbResolution?.formula) {
            this.logger.debug(`Using knowledgebase formula for ${htsNumber}`);
            return {
              formula: kbResolution.formula,
              source: 'knowledgebase',
              confidence: kbResolution.confidence ?? 0.6,
              formulaType: isNonNTR ? 'OTHER' : 'GENERAL',
            };
          }
        }
      } catch (error) {
        this.logger.warn(`Knowledgebase resolution failed: ${error.message}`);
      }
    }

    // Priority 4: Historical 2025 fallback for requests dated in/through 2025.
    const historicalFormula = await this.resolveHistorical2025Formula(
      htsNumber,
      context.entryDate,
    );
    if (historicalFormula) {
      this.logger.debug(`Using 2025 history fallback for ${htsNumber}`);
      return {
        formula: historicalFormula.formula,
        source: 'general',
        confidence: historicalFormula.confidence,
        formulaType: 'GENERAL',
        variables: historicalFormula.variables,
      };
    }

    throw new Error(`No formula available for HTS ${htsNumber}`);
  }

  private async loadBestMatchingEntry(
    htsNumber: string,
    version?: string,
  ): Promise<HtsEntity | null> {
    const hierarchyDigits = this.buildHtsHierarchyDigits(htsNumber);
    if (hierarchyDigits.length === 0) {
      return null;
    }

    let fallbackEntry: HtsEntity | null = null;

    for (const digits of hierarchyDigits) {
      const entry = await this.findBestEntryByDigits(digits, version);
      if (!entry) {
        continue;
      }

      if (!fallbackEntry) {
        fallbackEntry = entry;
      }

      if (!this.hasRateOrFormulaData(entry)) {
        continue;
      }

      if (digits !== hierarchyDigits[0]) {
        this.logger.debug(
          `Using ancestor HTS ${entry.htsNumber} for ${htsNumber} (rate/formula fallback)`,
        );
      }

      return entry;
    }

    return fallbackEntry;
  }

  private buildHtsHierarchyDigits(htsNumber: string): string[] {
    const digits = (htsNumber || '').replace(/\D/g, '');
    if (digits.length < 6) {
      return digits ? [digits] : [];
    }

    const levels = new Set<number>();
    if (digits.length >= 10) levels.add(10);
    if (digits.length >= 8) levels.add(8);
    levels.add(6);

    return Array.from(levels).map((len) => digits.slice(0, len));
  }

  private async findBestEntryByDigits(
    digits: string,
    version?: string,
  ): Promise<HtsEntity | null> {
    const qb = this.htsRepository
      .createQueryBuilder('hts')
      .where(`REGEXP_REPLACE(hts.htsNumber, '[^0-9]', '', 'g') = :digits`, {
        digits,
      });

    if (version) {
      qb.andWhere('(hts.version = :version OR hts.sourceVersion = :version)', {
        version,
      });
    } else {
      qb.andWhere('hts.isActive = true');
    }

    if (version) {
      qb.orderBy(
        'CASE WHEN hts.version = :version OR hts.sourceVersion = :version THEN 1 ELSE 2 END',
        'ASC',
      );
    }

    qb.addOrderBy('hts.isActive', 'DESC')
      .addOrderBy('hts.updatedAt', 'DESC')
      .limit(1);

    if (version) {
      qb.setParameter('version', version);
    }

    return qb.getOne();
  }

  private hasRateOrFormulaData(entry: HtsEntity): boolean {
    const metadata =
      (entry.metadata as Record<string, any> | null | undefined) || {};
    const stagedGeneralRate = (metadata?.stagedNormalized?.generalRate || '')
      .toString()
      .trim();

    return !!(
      (entry.rateFormula || '').trim() ||
      (entry.generalRate || '').trim() ||
      (entry.general || '').trim() ||
      stagedGeneralRate ||
      (entry.otherRateFormula || '').trim() ||
      (entry.otherRate || '').trim() ||
      (entry.adjustedFormula || '').trim() ||
      (entry.chapter99 || '').trim()
    );
  }

  private resolveNonNtrCountries(entry: HtsEntity): string[] {
    const fallback = ['CU', 'KP', 'BY', 'RU'];
    const source = entry.nonNtrApplicableCountries?.length
      ? entry.nonNtrApplicableCountries
      : fallback;
    return source.map((code) => code.toUpperCase());
  }

  private getManualFormulaLookupOrder(desired: string): string[] {
    const order = [desired];
    if (desired === 'OTHER_CHAPTER99') {
      order.push('OTHER', 'GENERAL');
    } else if (desired === 'ADJUSTED') {
      order.push('GENERAL');
    } else if (desired === 'OTHER') {
      order.push('GENERAL');
    }
    return order;
  }

  private extractYear(version?: string | null): number | undefined {
    if (!version) return undefined;
    const match = version.match(/(19|20)\d{2}/);
    return match ? parseInt(match[0], 10) : undefined;
  }

  private normalizeChapter99Headings(headings: string[]): string[] {
    return Array.from(
      new Set(
        (headings || [])
          .map((heading) => this.normalizeChapter99Heading(heading))
          .filter((heading): heading is string => !!heading),
      ),
    );
  }

  private normalizeChapter99Heading(
    value: string | null | undefined,
  ): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const dotted = trimmed.match(/^(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d{2}))?$/);
    if (dotted) {
      return dotted[4]
        ? `${dotted[1]}.${dotted[2]}.${dotted[3]}.${dotted[4]}`
        : `${dotted[1]}.${dotted[2]}.${dotted[3]}`;
    }

    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 8) {
      return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}${
        digits.length >= 10 ? `.${digits.slice(8, 10)}` : ''
      }`;
    }

    return null;
  }

  private parseDateOnly(value?: string): Date | null {
    if (!value || typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
      ),
    );
  }

  private toComparableRate(
    value: number | string | null | undefined,
  ): number | null {
    if (value === null || value === undefined) return null;
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseFloat(value)
          : NaN;
    if (!Number.isFinite(parsed)) return null;
    if (parsed >= 9999) return null;
    return parsed;
  }

  private isWeightUnit(unitCode: string | null | undefined): boolean {
    if (!unitCode) return false;
    const code = unitCode.trim().toUpperCase();
    return (
      code === 'KG' ||
      code === 'G' ||
      code === 'GM' ||
      code === 'CGM' ||
      code === 'CKG' ||
      code === 'T'
    );
  }

  private inferBaseFormulaFromAdjusted(entry: HtsEntity): string | null {
    const adjusted = (entry.adjustedFormula || '').trim();
    if (!adjusted) return null;

    const metadata =
      (entry.metadata as Record<string, any> | null | undefined) || {};
    const synthesis = (metadata.chapter99Synthesis || {}) as Record<
      string,
      any
    >;
    const adjustmentRate = this.toComparableRate(synthesis.adjustmentRate);
    if (adjustmentRate === null || adjustmentRate <= 0) {
      return null;
    }

    const additive = adjusted.match(
      /^\((.+)\)\s*\+\s*\(\s*value\s*\*\s*([0-9.]+)\s*\)$/i,
    );
    if (!additive) {
      return null;
    }

    const baseFormula = (additive[1] || '').trim();
    const formulaAdjustment = this.toComparableRate(additive[2]);
    if (!baseFormula || formulaAdjustment === null) {
      return null;
    }

    if (Math.abs(formulaAdjustment - adjustmentRate) > 1e-9) {
      return null;
    }

    return baseFormula;
  }

  private resolveDeterministicGeneralFormula(entry: HtsEntity): {
    formula: string;
    source: 'general';
    confidence: number;
    formulaType: 'GENERAL';
    variables: Array<{
      name: string;
      type: string;
      description?: string;
      unit?: string;
    }> | null;
  } | null {
    const candidates = this.collectGeneralRateCandidates(entry);
    for (const candidate of candidates) {
      if (!this.shouldAttemptDeterministicParse(candidate.rateText)) {
        continue;
      }

      const parsed = this.formulaGenerationService.generateFormulaByPattern(
        candidate.rateText,
        entry.unitOfQuantity || undefined,
      );

      if (!parsed?.formula) {
        continue;
      }

      return {
        formula: parsed.formula,
        source: 'general',
        confidence:
          candidate.source === 'stagedNormalized.generalRate' ? 0.78 : 0.82,
        formulaType: 'GENERAL',
        variables: this.buildVariableObjects(parsed.variables),
      };
    }

    return null;
  }

  private collectGeneralRateCandidates(entry: HtsEntity): Array<{
    source: 'generalRate' | 'general' | 'stagedNormalized.generalRate';
    rateText: string;
  }> {
    const metadata =
      (entry.metadata as Record<string, any> | null | undefined) || {};
    const stagedGeneralRate = (metadata?.stagedNormalized?.generalRate || '')
      .toString()
      .trim();

    const candidates = [
      {
        source: 'generalRate' as const,
        rateText: (entry.generalRate || '').toString().trim(),
      },
      {
        source: 'general' as const,
        rateText: (entry.general || '').toString().trim(),
      },
      {
        source: 'stagedNormalized.generalRate' as const,
        rateText: stagedGeneralRate,
      },
    ];

    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      if (!candidate.rateText) return false;
      const normalized = candidate.rateText.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  private shouldAttemptDeterministicParse(rateText: string): boolean {
    const text = rateText.trim().toLowerCase();
    if (!text) {
      return false;
    }

    // Skip legal/reference-driven rates that require external context.
    if (
      /\b(see|note|applicable subheading|provided in such subheading|rate applicable|duty equal|under bond|in lieu|drawback|except as provided)\b/.test(
        text,
      )
    ) {
      return false;
    }

    return true;
  }

  private buildVariableObjects(variableNames: string[]): Array<{
    name: string;
    type: string;
    description?: string;
    unit?: string;
  }> | null {
    if (!Array.isArray(variableNames) || variableNames.length === 0) {
      return null;
    }

    const deduped = Array.from(new Set(variableNames.filter((name) => !!name)));
    if (deduped.length === 0) {
      return null;
    }

    return deduped.map((name) => ({
      name,
      type: 'number',
      description:
        name === 'value'
          ? 'Declared value of goods in USD'
          : name === 'weight'
            ? 'Weight of goods in kilograms'
            : 'Number of imported items',
    }));
  }

  private async resolveHistorical2025Formula(
    htsNumber: string,
    entryDate?: string,
  ): Promise<{
    formula: string;
    confidence: number;
    variables: Array<{
      name: string;
      type: string;
      description?: string;
      unit?: string;
    }>;
  } | null> {
    const parsedEntryDate = this.parseDateOnly(entryDate);
    if (!parsedEntryDate || parsedEntryDate > this.historyFallbackCutoff) {
      return null;
    }

    const digits = htsNumber.replace(/\D/g, '');
    if (digits.length < 8) {
      return null;
    }
    const hts8 = digits.slice(0, 8);

    const row = await this.tariffHistory2025Repository
      .createQueryBuilder('h')
      .where('h.hts8 = :hts8', { hts8 })
      .andWhere('h.sourceYear = 2025')
      .andWhere('h.beginEffectDate <= :entryDate', {
        entryDate: parsedEntryDate.toISOString().slice(0, 10),
      })
      .andWhere('h.endEffectiveDate >= :entryDate', {
        entryDate: parsedEntryDate.toISOString().slice(0, 10),
      })
      .orderBy('h.beginEffectDate', 'DESC')
      .limit(1)
      .getOne();

    if (!row) {
      return null;
    }

    const adValRate = this.toComparableRate(row.mfnAdValRate);
    const specificRate = this.toComparableRate(row.mfnSpecificRate);
    const otherRate = this.toComparableRate(row.mfnOtherRate);
    const components: string[] = [];
    const variableNames = new Set<string>();

    if (adValRate !== null && adValRate !== 0) {
      components.push(`value * ${adValRate}`);
      variableNames.add('value');
    }

    if (specificRate !== null && specificRate !== 0) {
      const variable = this.isWeightUnit(row.quantity1Code)
        ? 'weight'
        : 'quantity';
      components.push(`${variable} * ${specificRate}`);
      variableNames.add(variable);
    }

    if (otherRate !== null && otherRate !== 0) {
      const variable = this.isWeightUnit(row.quantity2Code || row.quantity1Code)
        ? 'weight'
        : 'quantity';
      components.push(`${variable} * ${otherRate}`);
      variableNames.add(variable);
    }

    if (components.length === 0) {
      const parsedFromText =
        this.formulaGenerationService.generateFormulaByPattern(
          row.mfnTextRate || '',
          row.quantity1Code || undefined,
        );
      if (!parsedFromText?.formula) {
        return null;
      }

      return {
        formula: parsedFromText.formula,
        confidence: 0.92,
        variables: this.buildVariableObjects(parsedFromText.variables) || [],
      };
    }

    return {
      formula: components.join(' + '),
      confidence: 0.98,
      variables: this.buildVariableObjects(Array.from(variableNames)) || [],
    };
  }
}
