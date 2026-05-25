import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsExtraTaxEntity } from '@hts/core';
import { TariffKnowledgeCardEntity } from '../entities/tariff-knowledge-card.entity';
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
import { validateFormulaArtifacts } from './formula-artifact-validator.service';
import {
  classifyProgramFamily,
  extractChapter99FromConditions,
} from './program-family.helper';

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
    @InjectRepository(TariffKnowledgeCardEntity)
    private readonly knowledgeCardRepository: Repository<TariffKnowledgeCardEntity>,
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
    const primaryClassification = classifyProgramFamily({
      componentType: primaryComponentType,
      identifier: htsNumber,
    });
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
        chapter99HtsCode:
          primaryComponentType === 'chapter_99' ? htsNumber : null,
        programFamily: primaryClassification.programFamily,
        programAuthority: primaryClassification.programAuthority,
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
    const extraComponents =
      this.cardReadMode() === 'primary'
        ? await this.collectCardExtraTaxComponents({
            htsNumber,
            chapter,
            countryOfOrigin,
            calculationDate,
            selectedChapter99Headings: input.selectedChapter99Headings || [],
            certificate: input.certificate,
          })
        : await this.collectExtraTaxComponents({
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
      case 'knowledge_card':
        return 'tariff_knowledge_card';
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
      const formula = this.normalizeFormulaAliases(row.rateFormula);
      const variables = this.deriveExtraTaxVariables(formula);
      const appliesWhen = this.buildAppliesWhen(row, args.certificate);
      const chapter99Code = extractChapter99FromConditions(row.conditions);
      const classification = classifyProgramFamily({
        componentType,
        identifier: row.taxCode,
        legalReference: row.legalReference,
        chapter99Code,
      });

      components.push(
        this.withFormulaSemantics({
          componentType,
          formula,
          rateText: row.rateText || undefined,
          identifier: row.taxCode,
          chapter99HtsCode: chapter99Code,
          programFamily: classification.programFamily,
          programAuthority: classification.programAuthority,
          legalReference: row.legalReference || undefined,
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

  private async collectCardExtraTaxComponents(args: {
    htsNumber: string;
    chapter: string;
    countryOfOrigin: string;
    calculationDate: Date;
    selectedChapter99Headings: string[];
    certificate?: { agreement: string; claimed: boolean };
  }): Promise<{ components: TariffFormulaComponent[]; warnings: string[] }> {
    const warnings: string[] = [];
    const entryDay = this.formatDate(args.calculationDate);
    const htsScopes = [args.htsNumber, `${args.chapter}.*`, '*'];
    const countryCodes = [args.countryOfOrigin, 'ALL'];
    const cards = await this.knowledgeCardRepository
      .createQueryBuilder('card')
      .where('card.htsNumber IN (:...htsScopes)', { htsScopes })
      .andWhere('card.countryCode IN (:...countryCodes)', { countryCodes })
      .andWhere('card.destinationCode = :destinationCode', {
        destinationCode: 'US',
      })
      .andWhere('card.status IN (:...statuses)', {
        statuses: ['authoritative', 'provisional'],
      })
      .andWhere('card.consensusFormula IS NOT NULL')
      .andWhere('card.effectiveFrom <= :entryDay', { entryDay })
      .andWhere('(card.effectiveTo IS NULL OR card.effectiveTo >= :entryDay)', {
        entryDay,
      })
      .andWhere(
        '(card.componentType IN (:...componentTypes) OR card.rateClass IN (:...rateClasses))',
        {
          componentTypes: [
            'section_301',
            'section_232',
            'section_122',
            'mpf',
            'hmf',
            'post_tax',
          ],
          rateClasses: [
            'additional_duty',
            'section_301',
            'section_232',
            'section_122',
            'mpf',
            'hmf',
            'post_tax',
          ],
        },
      )
      .orderBy(
        `CASE WHEN card.htsNumber = :exactHts THEN 0 WHEN card.htsNumber = :chapterHts THEN 1 ELSE 2 END`,
        'ASC',
      )
      .addOrderBy(
        `CASE WHEN card.countryCode = :countryCode THEN 0 ELSE 1 END`,
        'ASC',
      )
      .addOrderBy('card.effectiveFrom', 'DESC')
      .setParameters({
        exactHts: args.htsNumber,
        chapterHts: `${args.chapter}.*`,
        countryCode: args.countryOfOrigin,
      })
      .getMany();

    if (cards.length === 0) {
      warnings.push(
        'Card primary mode did not find extra-tax component cards; using legacy extra-tax fallback.',
      );
      return this.collectExtraTaxComponents({
        htsNumber: args.htsNumber,
        chapter: args.chapter,
        countryOfOrigin: args.countryOfOrigin,
        calculationDate: args.calculationDate,
        selectedChapter99Headings: args.selectedChapter99Headings,
        certificate: args.certificate,
      });
    }

    const validCards = cards.filter((card) => {
      const validation = validateFormulaArtifacts(
        {
          formulaText: card.consensusFormula,
          formulaAst: card.consensusFormulaAst,
          conditionAst: card.consensusConditionAst || { kind: 'always' },
          unitDimensions: {},
          constraints: card.consensusConstraints || {},
          roundingPolicy: card.consensusRoundingPolicy || {
            mode: 'component_2dp',
          },
        },
        { requireRuntimeArtifacts: true },
      );
      if (!validation.valid) {
        warnings.push(
          `Knowledge card ${card.id} skipped: ${validation.errors.join('; ')}`,
        );
        return false;
      }
      return true;
    });

    if (validCards.length === 0) {
      warnings.push(
        'Card primary mode found only invalid extra-tax component cards; using legacy extra-tax fallback.',
      );
      return this.collectExtraTaxComponents({
        htsNumber: args.htsNumber,
        chapter: args.chapter,
        countryOfOrigin: args.countryOfOrigin,
        calculationDate: args.calculationDate,
        selectedChapter99Headings: args.selectedChapter99Headings,
        certificate: args.certificate,
      });
    }

    return {
      components: validCards.map((card) => this.cardToComponent(card)),
      warnings,
    };
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
      !this.conditionEngine.evaluateScope(row.conditions, {
        countryOfOrigin: args.countryOfOrigin,
        selectedChapter99Headings: args.selectedChapter99Headings,
      })
    ) {
      return false;
    }

    return true;
  }

  private cardToComponent(
    card: TariffKnowledgeCardEntity,
  ): TariffFormulaComponent {
    const formula = this.normalizeFormulaAliases(card.consensusFormula || '0');
    const variables = this.deriveExtraTaxVariables(formula);
    const cardComponentType = this.normalizeCardComponentType(
      card.componentType,
    );
    const cardIdentifier =
      typeof card.metadata?.taxCode === 'string'
        ? card.metadata.taxCode
        : card.id;
    const cardLegalReference =
      typeof card.metadata?.legalReference === 'string'
        ? card.metadata.legalReference
        : undefined;
    const cardChapter99 =
      extractChapter99FromConditions(card.consensusConditionAst) ||
      (typeof card.metadata?.chapter99HtsCode === 'string'
        ? card.metadata.chapter99HtsCode
        : null);
    const classification = classifyProgramFamily({
      componentType: cardComponentType,
      identifier: cardIdentifier,
      legalReference: cardLegalReference,
      chapter99Code: cardChapter99,
    });
    return this.withFormulaSemantics({
      componentType: cardComponentType,
      formula,
      identifier: cardIdentifier,
      chapter99HtsCode: cardChapter99,
      programFamily: classification.programFamily,
      programAuthority: classification.programAuthority,
      legalReference: cardLegalReference,
      description: `Knowledge card ${card.rateClass}/${card.componentType}`,
      requiredVariables: variables,
      appliesWhen: this.cardConditionToAppliesWhen(card.consensusConditionAst),
      conditions: card.consensusConditionAst || null,
      constraints: {
        minAmount:
          typeof card.consensusConstraints?.minAmount === 'number'
            ? card.consensusConstraints.minAmount
            : null,
        maxAmount:
          typeof card.consensusConstraints?.maxAmount === 'number'
            ? card.consensusConstraints.maxAmount
            : null,
        rounding: 'component_2dp',
      },
      confidence: Number(card.confidenceScore || 0),
      sourceCitation: {
        source: 'tariff_knowledge_card',
        rowIdentifier: card.id,
        effectiveDate: card.effectiveFrom,
        confidence: Number(card.confidenceScore || 0),
        parserMethod: 'knowledge_card',
      },
    });
  }

  private normalizeCardComponentType(
    componentType: string,
  ): TariffComponentType {
    const value = (componentType || '').toLowerCase();
    if (
      [
        'base',
        'special',
        'non_ntr',
        'chapter_98',
        'chapter_99',
        'section_301',
        'section_232',
        'section_122',
        'mpf',
        'hmf',
        'post_tax',
      ].includes(value)
    ) {
      return value as TariffComponentType;
    }
    return 'chapter_99';
  }

  private cardConditionToAppliesWhen(
    condition: Record<string, unknown> | null,
  ): TariffApplyCondition {
    if (!condition || typeof condition !== 'object') {
      return { kind: 'always' };
    }
    if (
      condition.kind === 'requires_chapter99_selection' &&
      typeof condition.heading === 'string'
    ) {
      return {
        kind: 'requires_chapter99_selection',
        heading: condition.heading,
      };
    }
    if (
      condition.kind === 'requires_certificate' &&
      typeof condition.agreement === 'string'
    ) {
      return { kind: 'requires_certificate', agreement: condition.agreement };
    }
    if (condition.kind === 'country_in' && Array.isArray(condition.countries)) {
      return {
        kind: 'country_in',
        countries: condition.countries
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.toUpperCase()),
      };
    }
    if (
      condition.kind === 'country_not_in' &&
      Array.isArray(condition.countries)
    ) {
      return {
        kind: 'country_not_in',
        countries: condition.countries
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.toUpperCase()),
      };
    }
    return { kind: 'always' };
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
    // Default: an unlabeled additional tariff is treated as a generic
    // Chapter 99 row. classifyProgramFamily() will downgrade it to
    // `other_chapter_99` so we don't silently collapse new programs into
    // Section 301. Pre-2026 behavior was to default to `section_301`,
    // which masked Section 201/421, IEEPA, quota, MTB, etc.
    return 'chapter_99';
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

  private normalizeFormulaAliases(formula: string): string {
    return formula.replace(/\bpf_liter\b/g, 'proof_liter');
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
      case 'weight_ton':
        return 'Weight of goods (metric tons)';
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
      case 'volume_barrel':
        return 'Volume in barrels';
      case 'volume_m3':
        return 'Volume in cubic meters';
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
    if (name === 'weight_ton') return 't';
    if (name === 'quantity_each') return 'each';
    if (name === 'quantity_pair') return 'pair';
    if (name === 'quantity_dozen') return 'dozen';
    if (name === 'quantity_set') return 'set';
    if (name === 'quantity_gross') return 'gross';
    if (name === 'volume_liter') return 'L';
    if (name === 'proof_liter') return 'proof L';
    if (name === 'volume_barrel') return 'bbl';
    if (name === 'volume_m3') return 'm3';
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
    if (name === 'weight' || name === 'weight_kg' || name === 'weight_ton')
      return 'weight';
    if (name.startsWith('quantity')) return 'quantity';
    if (name.includes('liter') || name.startsWith('volume_')) return 'volume';
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

  private cardReadMode(): 'off' | 'shadow' | 'primary' {
    const raw = (process.env.TARIFF_CARD_READ_MODE || 'shadow').toLowerCase();
    if (raw === 'primary' || raw === 'off') {
      return raw;
    }
    return 'shadow';
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
