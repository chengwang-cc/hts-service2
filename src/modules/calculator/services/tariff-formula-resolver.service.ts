import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsExtraTaxEntity } from '@hts/core';
import { RateRetrievalService } from './rate-retrieval.service';
import {
  FormulaVariable,
  ResolveFormulaInput,
  ResolveFormulaResult,
  SourceCitationRef,
  TariffApplyCondition,
  TariffComponentType,
  TariffFormulaComponent,
} from './tariff-types';
import { FormulaSemanticsService } from './formula-semantics.service';
import { TariffConditionEngineService } from './tariff-condition-engine.service';

/**
 * TariffFormulaResolver
 *
 * Single source-of-truth resolver that returns componentized formulas for a
 * given HTS code / country / date. Replaces the ai-service proxy endpoints
 * `GET /calculator/formula` and `POST /calculator/tariff-rates` used to hit.
 *
 * Each returned component carries its own formula, required variables,
 * source citation, confidence, and an `appliesWhen` condition so downstream
 * evaluators can decide whether to apply it.
 */
@Injectable()
export class TariffFormulaResolverService {
  private readonly logger = new Logger(TariffFormulaResolverService.name);

  constructor(
    private readonly rateRetrievalService: RateRetrievalService,
    private readonly formulaSemantics: FormulaSemanticsService,
    private readonly conditionEngine: TariffConditionEngineService,
    @InjectRepository(HtsExtraTaxEntity)
    private readonly extraTaxRepository: Repository<HtsExtraTaxEntity>,
  ) {}

  async resolve(input: ResolveFormulaInput): Promise<ResolveFormulaResult> {
    const htsNumber = (input.htsNumber || '').trim();
    const countryOfOrigin = (input.countryOfOrigin || '').trim().toUpperCase();
    const destinationCountry = (input.destinationCountry || 'US').toUpperCase();

    if (!htsNumber) {
      return this.blocked(
        input,
        'INVALID_HTS_NUMBER',
        'HTS number is required',
      );
    }

    if (!countryOfOrigin) {
      return this.blocked(
        input,
        'INVALID_COUNTRY_OF_ORIGIN',
        'Country of origin is required',
      );
    }

    if (destinationCountry !== 'US') {
      // P0 ships US-only. Multi-jurisdiction resolution lands in P1+.
      return this.blocked(
        input,
        'UNSUPPORTED_DESTINATION',
        `Destination ${destinationCountry} is not supported in this version`,
      );
    }

    const warnings: string[] = [];
    const citations: SourceCitationRef[] = [];
    const components: TariffFormulaComponent[] = [];

    // Reciprocal and other system-selected Chapter 99 headings are applied
    // before this resolver by PolicyApplicabilityService so formula and live
    // calculation paths share the same policy selection behavior.

    // ── Base / special / non-NTR / ch99-derived primary component ─────────
    let primary: Awaited<ReturnType<RateRetrievalService['getRate']>>;
    try {
      primary = await this.rateRetrievalService.getRate(
        htsNumber,
        countryOfOrigin,
        input.htsVersion,
        {
          entryDate: input.entryDate,
          selectedChapter99Headings: input.selectedChapter99Headings || [],
        },
      );
    } catch (error: any) {
      return this.blocked(
        input,
        'NO_FORMULA',
        error?.message || 'No formula available for this HTS code',
      );
    }

    const primaryComponentType = this.mapPrimaryComponentType(
      primary.formulaType,
      primary.source,
    );
    components.push(
      this.withFormulaSemantics({
        componentType: primaryComponentType,
        formula: primary.formula,
        requiredVariables: (primary.variables || []).map((v) => ({
          name: v.name,
          type: v.type,
          description: v.description,
          unit: v.unit,
          dimension: v.dimension as FormulaVariable['dimension'],
        })),
        identifier: htsNumber,
        description: this.describePrimary(primaryComponentType, primary.source),
        appliesWhen: { kind: 'always' },
        confidence: primary.confidence,
        sourceCitation: {
          source: this.sourceLabel(primary.source),
          rowIdentifier: htsNumber,
          effectiveDate: input.entryDate,
          confidence: primary.confidence,
          parserMethod: primary.source,
        },
      }),
    );

    if (primary.overrideExtraTax) {
      // Manual override flagged: skip extra-tax expansion entirely.
      const allRequiredVariables = this.aggregateVariables(components);
      return {
        htsNumber,
        effectiveHtsCode: htsNumber,
        components,
        allRequiredVariables,
        warnings,
        citations,
        systemSelectedChapter99Headings: [],
        blocked: false,
        message: '',
      };
    }

    // ── Extra-tax components (Section 301/232/122, IEEPA, MPF, HMF, etc.) ─
    const calculationDate = this.parseCalculationDate(input.entryDate);
    const chapter = htsNumber.substring(0, 2);
    const extraComponents = await this.collectExtraTaxComponents({
      htsNumber,
      chapter,
      countryOfOrigin,
      calculationDate,
      selectedChapter99Headings: input.selectedChapter99Headings || [],
      certificate: input.certificate,
    });
    components.push(...extraComponents.components);
    warnings.push(...extraComponents.warnings);

    const allRequiredVariables = this.aggregateVariables(components);

    return {
      htsNumber,
      effectiveHtsCode: htsNumber,
      components,
      allRequiredVariables,
      warnings,
      citations,
      systemSelectedChapter99Headings: [],
      blocked: false,
      message: '',
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private mapPrimaryComponentType(
    formulaType: string | undefined,
    source: string,
  ): TariffComponentType {
    if (formulaType === 'OTHER' || formulaType === 'OTHER_CHAPTER99') {
      return 'non_ntr';
    }
    if (formulaType === 'ADJUSTED') {
      return 'chapter_99';
    }
    if (source === 'manual') {
      // Manual overrides are still semantically "base" unless otherwise tagged.
      return 'base';
    }
    return 'base';
  }

  private describePrimary(
    componentType: TariffComponentType,
    source: string,
  ): string {
    switch (componentType) {
      case 'non_ntr':
        return 'Non-NTR (Column 2) rate';
      case 'chapter_99':
        return 'Chapter 99 adjusted rate';
      case 'base':
      default:
        return source === 'manual'
          ? 'Base rate (manual override)'
          : 'Base (general / MFN) rate';
    }
  }

  private sourceLabel(source: string): string {
    switch (source) {
      case 'manual':
        return 'manual_override';
      case 'knowledgebase':
        return 'knowledgebase';
      case 'general':
        return 'hts_general';
      case 'other':
        return 'hts_non_ntr';
      case 'adjusted':
        return 'hts_chapter_99';
      default:
        return source || 'hts';
    }
  }

  private aggregateVariables(
    components: TariffFormulaComponent[],
  ): FormulaVariable[] {
    const seen = new Set<string>();
    const out: FormulaVariable[] = [];
    for (const c of components) {
      for (const v of c.requiredVariables || []) {
        if (seen.has(v.name)) continue;
        seen.add(v.name);
        out.push(v);
      }
    }
    return out;
  }

  private parseCalculationDate(entryDate?: string): Date {
    if (!entryDate || typeof entryDate !== 'string') {
      return new Date();
    }
    const trimmed = entryDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const d = new Date(`${trimmed}T12:00:00Z`);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  private async collectExtraTaxComponents(args: {
    htsNumber: string;
    chapter: string;
    countryOfOrigin: string;
    calculationDate: Date;
    selectedChapter99Headings: string[];
    certificate?: { agreement: string; claimed: boolean };
  }): Promise<{ components: TariffFormulaComponent[]; warnings: string[] }> {
    const warnings: string[] = [];

    const rows = await this.extraTaxRepository.find({
      where: { isActive: true },
      order: { priority: 'ASC' },
    });

    const matched = rows.filter((row) => this.matchesExtraTaxScope(row, args));

    const components: TariffFormulaComponent[] = [];

    // Conditional rows may exclude reciprocal baselines; compute that flag.
    const matchedConditionalExclusions = matched.filter(
      (row) =>
        this.normalizeType(row.extraRateType) === 'CONDITIONAL' &&
        this.isTruthyFlag((row.conditions || {}).excludesReciprocalBaseline),
    );
    const excludeReciprocalBaseline = matchedConditionalExclusions.length > 0;

    for (const row of matched) {
      const type = this.normalizeType(row.extraRateType);
      if (type === 'CONDITIONAL') {
        // CONDITIONAL rows do not emit components; they only modulate ADD_ONs.
        continue;
      }
      if (!row.rateFormula) {
        continue;
      }
      if (this.conditionEngine.isPolicyMarkerOnly(row.conditions)) {
        continue;
      }

      if (excludeReciprocalBaseline && this.isReciprocalBaselineRule(row)) {
        warnings.push(
          `Reciprocal baseline ${row.taxCode} suppressed by conditional exclusion`,
        );
        continue;
      }

      const componentType = this.classifyExtraTax(row);
      const variables = this.deriveExtraTaxVariables(row.rateFormula);
      const appliesWhen = this.buildAppliesWhen(row, args.certificate);

      components.push(
        this.withFormulaSemantics({
          componentType,
          formula: row.rateFormula,
          rateText: row.rateText || undefined,
          identifier: row.taxCode,
          description: row.description || row.taxName,
          requiredVariables: variables,
          appliesWhen,
          conditions: row.conditions || null,
          constraints: {
            minAmount: row.minimumAmount,
            maxAmount: row.maximumAmount,
            rounding: 'component_2dp',
          },
          confidence: 0.95,
          sourceCitation: {
            source: row.legalReference || 'hts_extra_taxes',
            rowIdentifier: row.taxCode,
            effectiveDate: row.effectiveDate
              ? this.formatDate(row.effectiveDate)
              : undefined,
            confidence: 0.95,
            parserMethod: 'extra_tax_table',
          },
        }),
      );
    }

    return { components, warnings };
  }

  private matchesExtraTaxScope(
    row: HtsExtraTaxEntity,
    args: {
      htsNumber: string;
      chapter: string;
      countryOfOrigin: string;
      calculationDate: Date;
      selectedChapter99Headings: string[];
    },
  ): boolean {
    const taxCountry = (row.countryCode || 'ALL').toUpperCase();
    // Earlier bug: an OR chain between row.htsNumber and row.htsChapter
    // made a chapter-scoped rule fire for every htsNumber it spanned.
    // Use explicit precedence: prefer specific htsNumber over chapter.
    const taxHtsNumber = (row.htsNumber || '').trim();
    let htsMatches: boolean;
    if (taxHtsNumber && taxHtsNumber !== '*') {
      htsMatches = taxHtsNumber === args.htsNumber;
    } else if (row.htsChapter) {
      htsMatches = row.htsChapter === args.chapter;
    } else {
      htsMatches = true;
    }
    if (!htsMatches) return false;

    if (
      !this.conditionEngine.isCountryMatch(taxCountry, args.countryOfOrigin)
    ) {
      return false;
    }

    const calcDay = this.toDayUtc(args.calculationDate);
    if (row.effectiveDate) {
      const eff = this.toDayUtc(row.effectiveDate);
      if (eff && calcDay && eff.getTime() > calcDay.getTime()) return false;
    }
    if (row.expirationDate) {
      const exp = this.toDayUtc(row.expirationDate);
      if (exp && calcDay && exp.getTime() < calcDay.getTime()) return false;
    }

    if (
      !this.conditionEngine.evaluate(row.conditions, {
        countryOfOrigin: args.countryOfOrigin,
        selectedChapter99Headings: args.selectedChapter99Headings,
      })
    ) {
      return false;
    }

    return true;
  }

  private classifyExtraTax(row: HtsExtraTaxEntity): TariffComponentType {
    const taxCode = (row.taxCode || '').toUpperCase();
    const ref = (row.legalReference || '').toUpperCase();
    if (taxCode.startsWith('MPF')) return 'mpf';
    if (taxCode.startsWith('HMF')) return 'hmf';
    if (taxCode.includes('SECTION_301') || ref.includes('SECTION 301')) {
      return 'section_301';
    }
    if (taxCode.includes('SECTION_232') || ref.includes('SECTION 232')) {
      return 'section_232';
    }
    if (taxCode.includes('SECTION_122') || ref.includes('SECTION 122')) {
      return 'section_122';
    }
    if (
      taxCode.startsWith('CH99') ||
      taxCode.startsWith('CHAPTER_99') ||
      taxCode.startsWith('IEEPA') ||
      taxCode.startsWith('RECIP_')
    ) {
      return 'chapter_99';
    }
    const type = this.normalizeType(row.extraRateType);
    if (type === 'POST_CALCULATION') return 'post_tax';
    // Default: bucket as section_301-style additional tariff.
    return 'section_301';
  }

  private buildAppliesWhen(
    row: HtsExtraTaxEntity,
    certificate?: { agreement: string; claimed: boolean },
  ): TariffApplyCondition {
    const conditions = row.conditions || {};
    const requiredHeading = this.normalizeChapter99Heading(
      typeof conditions.htsHeading === 'string' ? conditions.htsHeading : null,
    );
    if (requiredHeading) {
      return { kind: 'requires_chapter99_selection', heading: requiredHeading };
    }
    if (
      this.isTruthyFlag(conditions.requiresCertificate) &&
      typeof conditions.tradeAgreementCode === 'string'
    ) {
      const agreement = (conditions.tradeAgreementCode as string)
        .trim()
        .toUpperCase();
      const claimed = certificate
        ? certificate.agreement.toUpperCase() === agreement &&
          !!certificate.claimed
        : false;
      // Encode as requires_certificate; calling code can enforce.
      return { kind: 'requires_certificate', agreement };
    }
    const countryCode = (row.countryCode || 'ALL').toUpperCase();
    if (countryCode !== 'ALL') {
      return { kind: 'country_in', countries: [countryCode] };
    }
    return { kind: 'always' };
  }

  private deriveExtraTaxVariables(formula: string): FormulaVariable[] {
    const names = new Set<string>();
    const re = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(formula)) !== null) {
      const name = m[1];
      if (this.isMathjsKeyword(name)) continue;
      names.add(name);
    }
    return Array.from(names).map((name) => ({
      name,
      type: 'number',
      description: this.describeVariable(name),
      unit: this.describeVariableUnit(name),
      dimension: this.describeVariableDimension(name),
    }));
  }

  private isMathjsKeyword(name: string): boolean {
    return new Set([
      'min',
      'max',
      'abs',
      'round',
      'ceil',
      'floor',
      'log',
      'sqrt',
      'pow',
      'exp',
      'PI',
      'e',
      'true',
      'false',
    ]).has(name);
  }

  private describeVariable(name: string): string {
    switch (name) {
      case 'value':
        return 'Declared value of goods';
      case 'weight':
        return 'Weight of goods (kg)';
      case 'quantity':
        return 'Quantity of items';
      case 'quantity_each':
        return 'Number of individual items';
      case 'quantity_pair':
        return 'Number of pairs';
      case 'quantity_dozen':
        return 'Number of dozens';
      case 'quantity_set':
        return 'Number of sets';
      case 'quantity_gross':
        return 'Number of gross units';
      case 'volume_liter':
        return 'Volume in liters';
      case 'proof_liter':
        return 'Alcohol proof liters';
      case 'area_m2':
        return 'Area in square meters';
      case 'length_m':
        return 'Length in meters';
      case 'duty':
        return 'Computed duty so far';
      case 'total':
        return 'Declared value + duty so far';
      default:
        return `Additional input: ${name}`;
    }
  }

  private describeVariableUnit(name: string): string | undefined {
    if (name === 'weight' || name === 'weight_kg') return 'kg';
    if (name === 'quantity_each') return 'each';
    if (name === 'quantity_pair') return 'pair';
    if (name === 'quantity_dozen') return 'dozen';
    if (name === 'quantity_set') return 'set';
    if (name === 'quantity_gross') return 'gross';
    if (name === 'volume_liter') return 'L';
    if (name === 'proof_liter') return 'proof L';
    if (name === 'area_m2') return 'm2';
    if (name === 'length_m') return 'm';
    return undefined;
  }

  private describeVariableDimension(
    name: string,
  ): FormulaVariable['dimension'] {
    if (name === 'value' || name === 'duty' || name === 'total') {
      return 'money';
    }
    if (name === 'weight' || name === 'weight_kg') return 'weight';
    if (name.startsWith('quantity')) return 'quantity';
    if (name.includes('liter')) return 'volume';
    if (name.includes('area')) return 'area';
    if (name.includes('length')) return 'length';
    return undefined;
  }

  private isTruthyFlag(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'y', 'on'].includes(
        value.trim().toLowerCase(),
      );
    }
    return false;
  }

  private isPolicyMarkerOnly(
    conditions: Record<string, any> | null | undefined,
  ): boolean {
    return this.conditionEngine.isPolicyMarkerOnly(conditions);
  }

  private isReciprocalBaselineRule(row: HtsExtraTaxEntity): boolean {
    const code = (row.taxCode || '').toUpperCase();
    const country = (row.countryCode || '').toUpperCase();
    return code.startsWith('RECIP_') && country === 'ALL';
  }

  private normalizeType(type: string | null | undefined): string {
    return (type || '').toUpperCase();
  }

  private normalizeChapter99Heading(value: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (/^99\d{2}\.\d{2}\.\d{2}(?:\.\d{2})?$/.test(trimmed)) return trimmed;
    const digits = trimmed.replace(/[^0-9]/g, '');
    if (/^99\d{6}$/.test(digits)) {
      return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
    }
    if (/^99\d{8}$/.test(digits)) {
      return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}.${digits.slice(8, 10)}`;
    }
    return null;
  }

  private toDayUtc(value: Date | string): Date | null {
    const d = typeof value === 'string' ? new Date(value) : value;
    if (!d || Number.isNaN(d.getTime())) return null;
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12),
    );
  }

  private formatDate(d: Date | string): string {
    const day = this.toDayUtc(d);
    return (day || new Date()).toISOString().slice(0, 10);
  }

  private blocked(
    input: ResolveFormulaInput,
    blockReason: string,
    message: string,
  ): ResolveFormulaResult {
    this.logger.debug(
      `Block ${blockReason} for ${input.htsNumber}/${input.countryOfOrigin}: ${message}`,
    );
    return {
      htsNumber: input.htsNumber,
      effectiveHtsCode: input.htsNumber,
      components: [],
      allRequiredVariables: [],
      warnings: [],
      citations: [],
      blocked: true,
      blockReason,
      message,
    };
  }

  private withFormulaSemantics(
    component: TariffFormulaComponent,
  ): TariffFormulaComponent {
    const semantics = this.formulaSemantics.analyze(
      component.formula,
      component.requiredVariables,
    );
    return {
      ...component,
      formulaCanonical: semantics.canonicalFormula,
      formulaAst: semantics.formulaAst as Record<string, any>,
      formulaSemanticHash: semantics.semanticHash,
      unitDimensions: this.formulaSemantics.variablesToDimensions(
        component.requiredVariables,
      ),
    };
  }
}
