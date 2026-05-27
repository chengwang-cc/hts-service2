import { Injectable, Logger, Optional } from '@nestjs/common';
import { TariffFormulaResolverService } from './tariff-formula-resolver.service';
import { FormulaEvaluationService } from './formula-evaluation.service';
import { FormulaScopeService } from './formula-scope.service';
import { PolicyApplicabilityService } from './policy-applicability.service';
import { TariffConditionEngineService } from './tariff-condition-engine.service';
import { TariffConfidenceService } from './tariff-confidence.service';
import {
  BatchFormulaLineResult,
  BatchRateLineResult,
  BatchRateRequest,
  FormulaVariable,
  SourceCitationRef,
  TariffComponentType,
  TariffFormulaComponent,
} from './tariff-types';
import {
  classifyProgramFamily,
  extractChapter99FromConditions,
} from './program-family.helper';
import { ExceptionRuleRegistry } from '../../exception-rules/exception-rule.registry';
import type { ExceptionRuleContext } from '../../exception-rules/types';

/**
 * TariffRateBatchService
 *
 * Replaces the ai-service `/v2/tariff/rates` proxy. Returns per-row
 * componentized breakdowns plus structured totals. `totalDuty` is customs
 * duty only; MPF/HMF and tax components are reported separately in `fees`,
 * `taxes`, and `totals.payable`.
 *
 * Each request is resolved independently, so duplicate (htsCode, country)
 * rows with different `inputs` do not collapse — fixes the ai-service
 * `requests.find(...)` lookup bug.
 */
@Injectable()
export class TariffRateBatchService {
  private readonly logger = new Logger(TariffRateBatchService.name);

  constructor(
    private readonly resolver: TariffFormulaResolverService,
    private readonly evaluator: FormulaEvaluationService,
    private readonly formulaScope: FormulaScopeService,
    private readonly policyApplicability: PolicyApplicabilityService,
    private readonly conditionEngine: TariffConditionEngineService,
    private readonly tariffConfidence: TariffConfidenceService,
    // Optional so unit tests that hand-build the service don't have to
    // thread the registry in. Production wires it via DI.
    @Optional() private readonly exceptionRuleRegistry?: ExceptionRuleRegistry,
  ) {}

  async batchCalculate(
    requests: BatchRateRequest[],
    options: { failOnComponentError?: boolean } = {},
  ): Promise<BatchRateLineResult[]> {
    const out: BatchRateLineResult[] = [];
    for (const req of requests) {
      out.push(await this.calculateOne(req, options));
    }
    return out;
  }

  async batchFormulas(
    requests: Array<{
      htsCode: string;
      country: string;
      destination?: string;
      entryDate?: string;
      htsVersion?: string;
      selectedChapter99Headings?: string[];
    }>,
  ): Promise<BatchFormulaLineResult[]> {
    const out: BatchFormulaLineResult[] = [];
    for (const r of requests) {
      const policySelection =
        this.policyApplicability.applySystemChapter99Selections({
          additionalInputs: {},
          countryOfOrigin: r.country,
          calculationDate: this.parseCalculationDate(r.entryDate),
        });
      const resolved = await this.resolver.resolve({
        htsNumber: r.htsCode,
        countryOfOrigin: r.country,
        destinationCountry: 'US',
        entryDate: r.entryDate,
        htsVersion: r.htsVersion,
        selectedChapter99Headings: this.mergeHeadings(
          r.selectedChapter99Headings,
          policySelection.selectedChapter99Headings,
        ),
      });

      out.push({
        htsCode: r.htsCode,
        country: r.country,
        effectiveHtsCode: resolved.effectiveHtsCode ?? null,
        blocked: resolved.blocked,
        blockReason: resolved.blockReason ?? null,
        message: resolved.message,
        systemSelectedChapter99Headings:
          policySelection.systemSelectedChapter99Headings,
        formulas: resolved.components.map((c) => {
          const chapter99 = this.resolveChapter99Code(c);
          const classification = classifyProgramFamily({
            componentType: c.componentType,
            identifier: c.identifier,
            legalReference: c.legalReference,
            chapter99Code: chapter99,
          });
          return {
            componentType: c.componentType,
            tariffType: this.tariffTypeFromComponent(c.componentType),
            tariffTypeDescription: this.cleanTariffTypeDescription(
              c.description,
              c.componentType,
            ),
            formula: c.formula,
            formulaVariables: c.requiredVariables,
            chapter99HtsCode: chapter99,
            programFamily: c.programFamily ?? classification.programFamily,
            programAuthority:
              c.programAuthority ?? classification.programAuthority,
            legalReference: c.legalReference,
            rateText: c.rateText,
            formulaCanonical: c.formulaCanonical,
            formulaSemanticHash: c.formulaSemanticHash,
            appliesWhen: c.appliesWhen,
            conditions: c.conditions ?? null,
            constraints: c.constraints,
            sourceCitation: c.sourceCitation,
            identifier: c.identifier,
            confidence: c.confidence,
          };
        }),
        additionalInputs: this.collectRuleInputs({
          htsCode: r.htsCode,
          country: r.country,
          // 2026-05-27: honour caller-supplied destination so non-US
          // destinations (CA, KR, AU, NZ, EU, …) surface their own
          // FTA-qualifying flags. Falls back to 'US' for legacy callers.
          destination: (r.destination || 'US').toUpperCase(),
          asOfDate: this.parseCalculationDate(r.entryDate) ?? new Date(),
        }),
      });
    }
    return out;
  }

  /**
   * P2.T5 — walk the exception-rule registry for the requested
   * (htsCode, country, destination) and union each applicable rule's
   * `declaredInputs()`. Returns an empty array when no registry is
   * wired (unit tests, legacy callers) or no rule applies.
   *
   * Applicability is evaluated against a synthetic context with empty
   * additionalInputs because the user hasn't supplied any yet. Rules
   * whose `isApplicable()` checks HTS/destination/origin (the common
   * pattern) work correctly; rules that need actual user input to
   * decide applicability won't surface their inputs until after the
   * first submit — a known limitation, not yet observed in P2 scope.
   */
  private collectRuleInputs(args: {
    htsCode: string;
    country: string;
    destination: string;
    asOfDate: Date;
  }): FormulaVariable[] {
    if (!this.exceptionRuleRegistry) return [];
    const rules = this.exceptionRuleRegistry.rulesFor(args.destination);
    if (rules.length === 0) return [];
    const ctx: ExceptionRuleContext = {
      htsCode: args.htsCode,
      origin: (args.country || '').toUpperCase(),
      destination: args.destination,
      asOfDate: args.asOfDate,
      declaredValue: 0,
      currency: 'USD',
      additionalInputs: {},
      baseComponents: [],
      pendingComponents: [],
      firedRules: [],
    };
    const merged = new Map<string, FormulaVariable>();
    for (const rule of rules) {
      // 2026-05-27: use isInScope (when implemented) to decide whether
      // to surface this rule's inputs. Falls back to isApplicable for
      // rules that don't implement isInScope. This escapes the
      // catch-22 where an FTA-qualifying rule's flag input never
      // renders because the flag is unset → rule not applicable →
      // input not declared.
      try {
        const inScope = rule.isInScope
          ? rule.isInScope(ctx)
          : rule.isApplicable(ctx);
        if (!inScope) continue;
      } catch {
        continue; // a misbehaving rule does not block the formula response
      }
      // Pass ctx so declaredInputs can compute context-aware defaults
      // (e.g. usmca_qualifying = true when origin is MX/CA).
      for (const spec of rule.declaredInputs(ctx)) {
        const existing = merged.get(spec.name);
        if (existing && existing.defaultValue !== undefined) {
          // Existing entry already carries a context-aware default
          // (e.g. FtaQualifyingRuleBase's `usmca_qualifying = true`
          // because origin is in the USMCA partner set). Keep it; do
          // not let a later rule's bare declaration overwrite the
          // better metadata.
          continue;
        }
        const newEntry: FormulaVariable = {
          name: spec.name,
          type: spec.type,
          required: spec.required,
          label: spec.label,
          helpRef: spec.helpRef,
          allowedValues: spec.allowedValues,
          origin: 'exception_rule',
          ruleId: rule.id,
          defaultValue: spec.defaultValue,
        };
        if (existing) {
          // Existing has no defaultValue; this one might. Replace only
          // if the new spec carries new information.
          if (spec.defaultValue !== undefined) merged.set(spec.name, newEntry);
        } else {
          merged.set(spec.name, newEntry);
        }
      }
    }
    return Array.from(merged.values());
  }

  private async calculateOne(
    req: BatchRateRequest,
    options: { failOnComponentError?: boolean } = {},
  ): Promise<BatchRateLineResult> {
    const policySelection =
      this.policyApplicability.applySystemChapter99Selections({
        additionalInputs: req.inputs || {},
        countryOfOrigin: req.country,
        calculationDate: this.parseCalculationDate(req.entryDate),
      });
    const selectedChapter99Headings = this.mergeHeadings(
      req.selectedChapter99Headings,
      policySelection.selectedChapter99Headings,
    );
    const resolved = await this.resolver.resolve({
      htsNumber: req.htsCode,
      countryOfOrigin: req.country,
      destinationCountry: 'US',
      entryDate: req.entryDate,
      htsVersion: req.htsVersion,
      certificate: req.certificate,
      selectedChapter99Headings,
    });

    if (resolved.blocked) {
      const confidenceDetails = await this.tariffConfidence.scoreFor({
        htsNumber: req.htsCode,
        countryCode: req.country,
        destinationCode: 'US',
        fallbackConfidence: 0,
      });
      return {
        htsCode: req.htsCode,
        country: req.country,
        effectiveHtsCode: resolved.effectiveHtsCode,
        blocked: true,
        blockReason: resolved.blockReason ?? null,
        message: resolved.message,
        systemSelectedChapter99Headings:
          policySelection.systemSelectedChapter99Headings,
        totalDuty: 0,
        fees: 0,
        taxes: 0,
        totals: {
          duty: 0,
          fees: 0,
          taxes: 0,
          payable: 0,
        },
        confidence: confidenceDetails.score,
        confidenceDetails,
        breakdown: [],
      };
    }

    const inputs = policySelection.additionalInputs || req.inputs || {};
    const scoped = this.formulaScope.buildBaseScope({
      declaredValue: inputs.value,
      weightKg: inputs.weight,
      quantity: inputs.quantity,
      quantityUnit: inputs.quantityUnit,
      additionalInputs: inputs,
    });
    const baseVars = {
      value: scoped.value ?? 0,
      weight: scoped.weight ?? 0,
      quantity: scoped.quantity ?? 0,
    };
    const additionalInputs = scoped.additionalInputs;
    const effectiveReq: BatchRateRequest = {
      ...req,
      inputs: additionalInputs,
      selectedChapter99Headings,
    };

    // Evaluate non-fee/post components first to compute `duty` and `total`,
    // then evaluate fee / post_tax components against that running total.
    type Evaluated = {
      component: TariffFormulaComponent;
      amount: number;
      error: string | null;
    };

    const isPostStage = (c: TariffFormulaComponent) =>
      c.componentType === 'mpf' ||
      c.componentType === 'hmf' ||
      c.componentType === 'post_tax';

    const primary = resolved.components.filter((c) => !isPostStage(c));
    const post = resolved.components.filter(isPostStage);

    const evaluated: Evaluated[] = [];
    let runningDuty = 0;
    for (const c of primary) {
      if (!this.shouldEvaluate(c, effectiveReq)) {
        continue;
      }
      const variables = this.buildScope({
        component: c,
        baseVars,
        additional: additionalInputs,
        duty: runningDuty,
        total: baseVars.value + runningDuty,
      });
      const evaledResult = this.safeEvaluate(
        c.formula,
        variables,
        c.constraints,
      );
      if (evaledResult.error) {
        evaluated.push({ component: c, amount: 0, error: evaledResult.error });
        continue;
      }
      runningDuty += evaledResult.amount;
      evaluated.push({
        component: c,
        amount: evaledResult.amount,
        error: null,
      });
    }

    const postTariffTotal = baseVars.value + runningDuty;
    let runningFees = 0;
    let runningTaxes = 0;
    for (const c of post) {
      if (!this.shouldEvaluate(c, effectiveReq)) {
        continue;
      }
      const variables = this.buildScope({
        component: c,
        baseVars,
        additional: additionalInputs,
        duty: runningDuty,
        total: postTariffTotal,
      });
      const evaledResult = this.safeEvaluate(
        c.formula,
        variables,
        c.constraints,
      );
      if (evaledResult.error) {
        evaluated.push({ component: c, amount: 0, error: evaledResult.error });
        continue;
      }
      if (c.componentType === 'post_tax') {
        runningTaxes += evaledResult.amount;
      } else {
        runningFees += evaledResult.amount;
      }
      evaluated.push({
        component: c,
        amount: evaledResult.amount,
        error: null,
      });
    }

    const totalDuty = runningDuty;
    const totalFees = runningFees;
    const totalTaxes = runningTaxes;
    const payable = totalDuty + totalFees + totalTaxes;
    const confidenceDetails = await this.tariffConfidence.scoreFor({
      htsNumber: req.htsCode,
      countryCode: req.country,
      destinationCode: 'US',
      fallbackConfidence: this.componentConfidence(resolved.components),
    });

    const breakdown = evaluated.map((e) => {
      const chapter99 = this.resolveChapter99Code(e.component);
      const classification = classifyProgramFamily({
        componentType: e.component.componentType,
        identifier: e.component.identifier,
        legalReference: e.component.legalReference,
        chapter99Code: chapter99,
      });
      return {
        componentType: e.component.componentType,
        tariffType: this.tariffTypeFromComponent(e.component.componentType),
        tariffTypeDescription: this.cleanTariffTypeDescription(
          e.component.description,
          e.component.componentType,
        ),
        amount: this.round2(e.amount),
        formula: e.component.formula,
        formulaVariables: e.component.requiredVariables,
        chapter99HtsCode: chapter99,
        programFamily:
          e.component.programFamily ?? classification.programFamily,
        programAuthority:
          e.component.programAuthority ?? classification.programAuthority,
        legalReference: e.component.legalReference,
        rateText: e.component.rateText,
        formulaCanonical: e.component.formulaCanonical,
        formulaSemanticHash: e.component.formulaSemanticHash,
        appliesWhen: e.component.appliesWhen,
        conditions: e.component.conditions ?? null,
        constraints: e.component.constraints,
        sourceCitation: e.component.sourceCitation,
        identifier: e.component.identifier,
        confidence: e.component.confidence,
        error: e.error,
      };
    });
    const evaluationErrors = evaluated
      .filter((entry) => entry.error)
      .map((entry) => entry.error as string);
    const blockedByEvaluationError =
      !!options.failOnComponentError && evaluationErrors.length > 0;

    return {
      htsCode: req.htsCode,
      country: req.country,
      effectiveHtsCode: resolved.effectiveHtsCode,
      blocked: blockedByEvaluationError,
      blockReason: blockedByEvaluationError
        ? `COMPONENT_EVALUATION_ERROR: ${evaluationErrors[0]}`
        : null,
      message: blockedByEvaluationError
        ? 'One or more tariff components failed formula evaluation.'
        : resolved.message,
      systemSelectedChapter99Headings:
        policySelection.systemSelectedChapter99Headings,
      totalDuty: this.round2(totalDuty),
      fees: this.round2(totalFees),
      taxes: this.round2(totalTaxes),
      totals: {
        duty: this.round2(totalDuty),
        fees: this.round2(totalFees),
        taxes: this.round2(totalTaxes),
        payable: this.round2(payable),
      },
      confidenceScore: confidenceDetails.score,
      confidence: confidenceDetails.score,
      confidenceDetails,
      breakdown,
      sources: this.dedupeSources(evaluated.map((e) => e.component)),
    };
  }

  /**
   * Resolve the Chapter 99 HTS code carried by a component. Prefer the
   * explicit `chapter99HtsCode` field, then fall back to:
   *   1. `identifier` when that looks like a 9903.xx.yy code
   *   2. conditions.htsHeading / conditions.chapter99Heading
   *
   * This covers all components driven by a Chapter 99 rule, not only those
   * with `componentType === 'chapter_99'` (Section 301/232/IEEPA/etc.).
   */
  private resolveChapter99Code(c: TariffFormulaComponent): string | null {
    if (c.chapter99HtsCode) return c.chapter99HtsCode;
    if (
      c.identifier &&
      /^99\d{2}\.\d{2}\.\d{2}(\.\d{2})?$/.test(c.identifier)
    ) {
      return c.identifier;
    }
    return extractChapter99FromConditions(c.conditions);
  }

  private dedupeSources(
    components: TariffFormulaComponent[],
  ): SourceCitationRef[] {
    const seen = new Map<string, SourceCitationRef>();
    for (const c of components) {
      const cit = c.sourceCitation;
      if (!cit) continue;
      const key = `${cit.source}|${cit.rowIdentifier ?? ''}|${cit.url ?? ''}`;
      if (!seen.has(key)) seen.set(key, cit);
    }
    return Array.from(seen.values());
  }

  private shouldEvaluate(
    component: TariffFormulaComponent,
    req: BatchRateRequest,
  ): boolean {
    const when = component.appliesWhen;
    if (
      component.conditions &&
      !this.conditionEngine.evaluate(component.conditions, {
        countryOfOrigin: req.country,
        declaredValue:
          typeof req.inputs?.value === 'number' ? req.inputs.value : undefined,
        additionalInputs: req.inputs,
        selectedChapter99Headings: req.selectedChapter99Headings || [],
        tradeAgreementCode: req.certificate?.agreement,
        tradeAgreementCertificate: req.certificate?.claimed,
      })
    ) {
      return false;
    }
    if (when.kind === 'always') return true;
    if (when.kind === 'country_in') {
      return when.countries.includes((req.country || '').toUpperCase());
    }
    if (when.kind === 'country_not_in') {
      return !when.countries.includes((req.country || '').toUpperCase());
    }
    if (when.kind === 'requires_chapter99_selection') {
      const selected = new Set(
        this.mergeHeadings(req.selectedChapter99Headings, []),
      );
      return selected.has(when.heading);
    }
    if (when.kind === 'requires_certificate') {
      if (!req.certificate) return false;
      return (
        req.certificate.agreement.toUpperCase() === when.agreement &&
        !!req.certificate.claimed
      );
    }
    return true;
  }

  private buildScope(args: {
    component: TariffFormulaComponent;
    baseVars: { value: number; weight: number; quantity: number };
    additional: Record<string, number>;
    duty: number;
    total: number;
  }): Record<string, unknown> {
    const additionalInputs: Record<string, number> = {};
    const scope: Record<string, unknown> = {
      value: args.baseVars.value,
      weight: args.baseVars.weight,
      quantity: args.baseVars.quantity,
      duty: args.duty,
      total: args.total,
      additionalInputs,
      declaredVariables: args.component.requiredVariables.map((v) => v.name),
    };

    const declared = new Set(
      args.component.requiredVariables.map((v) => v.name),
    );

    for (const [k, v] of Object.entries(args.additional || {})) {
      if (k === 'value' || k === 'weight' || k === 'quantity') continue;
      if (!declared.has(k)) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      additionalInputs[k] = v;
    }

    return scope;
  }

  private safeEvaluate(
    formula: string,
    variables: Record<string, unknown>,
    constraints?: TariffFormulaComponent['constraints'],
  ): { amount: number; error: string | null } {
    try {
      const { amount } = this.evaluator.evaluateWithConstraints(
        formula,
        variables,
        constraints,
      );
      return { amount, error: null };
    } catch (error: any) {
      this.logger.warn(
        `Formula evaluation failed for "${formula}": ${error?.message}`,
      );
      return { amount: 0, error: error?.message || 'evaluation error' };
    }
  }

  /**
   * Returns a user-safe `tariffTypeDescription`. Some rows were seeded from
   * an ai-service import that stamped the description with an
   * implementation-leaking marker like
   *   "Auto-imported from ai-service /v2/tariff/formulas. tariffType=section_301"
   * The public API must never expose that — replace any such description
   * (or trailing fragment) with a clean human label derived from the
   * componentType (`section_301` → `Section 301`, `metal_tariff` →
   * `Metal Tariff`, etc.).
   */
  private cleanTariffTypeDescription(
    rawDescription: string | null | undefined,
    componentType: TariffComponentType | string,
  ): string {
    const cleaned = (rawDescription ?? '').trim();
    if (
      !cleaned ||
      /\bauto-imported\b/i.test(cleaned) ||
      /\bai-service\b/i.test(cleaned)
    ) {
      return this.humanizeComponentType(componentType);
    }
    return cleaned;
  }

  /**
   * Human label for a tariff component type identifier — used as the
   * fallback whenever a description is missing or leaks implementation
   * details. `section_301` → `Section 301`, `metal_tariff` → `Metal Tariff`,
   * `mpf` → `Merchandise Processing Fee`, etc.
   */
  private humanizeComponentType(type: TariffComponentType | string): string {
    const specials: Record<string, string> = {
      base: 'Base (general / MFN) rate',
      special: 'Special / preferential rate',
      non_ntr: 'Other (non-NTR) rate',
      chapter_98: 'Chapter 98',
      chapter_99: 'Chapter 99',
      section_122: 'Section 122 Tariffs',
      section_201: 'Section 201',
      section_232: 'Section 232',
      section_301: 'Section 301',
      ieepa: 'IEEPA',
      reciprocal: 'Reciprocal tariff',
      metal_tariff: 'Section 232 (Metal)',
      mpf: 'Merchandise Processing Fee',
      hmf: 'Harbor Maintenance Fee',
      post_tax: 'Post-calculation tax',
    };
    const key = String(type ?? '').toLowerCase();
    if (specials[key]) return specials[key];
    return key
      .split(/[_-]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private tariffTypeFromComponent(type: TariffComponentType): string {
    switch (type) {
      case 'base':
        return 'GENERAL';
      case 'special':
        return 'SPECIAL';
      case 'non_ntr':
        return 'OTHER';
      case 'chapter_98':
        return 'CHAPTER_98';
      case 'chapter_99':
        return 'CHAPTER_99';
      case 'section_301':
        return 'SECTION_301';
      case 'section_232':
        return 'SECTION_232';
      case 'section_122':
        return 'SECTION_122';
      case 'mpf':
        return 'MPF';
      case 'hmf':
        return 'HMF';
      case 'post_tax':
        return 'POST_TAX';
    }
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }

  private componentConfidence(components: TariffFormulaComponent[]): number {
    if (components.length === 0) {
      return 0;
    }
    const sum = components.reduce((acc, component) => {
      const confidence = Number(component.confidence);
      return acc + (Number.isFinite(confidence) ? confidence : 0);
    }, 0);
    return sum / components.length;
  }

  private mergeHeadings(
    explicit: string[] | undefined,
    system: string[],
  ): string[] {
    const out = new Set<string>();
    for (const heading of explicit || []) {
      const normalized =
        this.policyApplicability.normalizeChapter99Heading(heading);
      if (normalized) out.add(normalized);
    }
    for (const heading of system || []) {
      const normalized =
        this.policyApplicability.normalizeChapter99Heading(heading);
      if (normalized) out.add(normalized);
    }
    return Array.from(out);
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
}
