import { Injectable, Logger } from '@nestjs/common';
import { TariffFormulaResolverService } from './tariff-formula-resolver.service';
import { FormulaEvaluationService } from './formula-evaluation.service';
import {
  BatchFormulaLineResult,
  BatchRateLineResult,
  BatchRateRequest,
  TariffComponentType,
  TariffFormulaComponent,
} from './tariff-types';

/**
 * TariffRateBatchService
 *
 * Replaces the ai-service `/v2/tariff/rates` proxy. Returns per-row
 * componentized breakdowns AND a top-level `totalDuty` that includes base +
 * special + chapter-99 + section duties + post-tax components — fixing the
 * ai-service bug where the top-level `rate` was base-only.
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
  ) {}

  async batchCalculate(
    requests: BatchRateRequest[],
  ): Promise<BatchRateLineResult[]> {
    const out: BatchRateLineResult[] = [];
    for (const req of requests) {
      out.push(await this.calculateOne(req));
    }
    return out;
  }

  async batchFormulas(
    requests: Array<{
      htsCode: string;
      country: string;
      entryDate?: string;
      htsVersion?: string;
      selectedChapter99Headings?: string[];
    }>,
  ): Promise<BatchFormulaLineResult[]> {
    const out: BatchFormulaLineResult[] = [];
    for (const r of requests) {
      const resolved = await this.resolver.resolve({
        htsNumber: r.htsCode,
        countryOfOrigin: r.country,
        destinationCountry: 'US',
        entryDate: r.entryDate,
        htsVersion: r.htsVersion,
        selectedChapter99Headings: r.selectedChapter99Headings,
      });

      out.push({
        htsCode: r.htsCode,
        country: r.country,
        effectiveHtsCode: resolved.effectiveHtsCode ?? null,
        blocked: resolved.blocked,
        blockReason: resolved.blockReason ?? null,
        message: resolved.message,
        formulas: resolved.components.map((c) => ({
          componentType: c.componentType,
          tariffType: this.tariffTypeFromComponent(c.componentType),
          tariffTypeDescription: c.description || c.componentType,
          formula: c.formula,
          formulaVariables: c.requiredVariables,
          chapter99HtsCode:
            c.componentType === 'chapter_99' ? c.identifier ?? null : null,
          confidence: c.confidence,
        })),
      });
    }
    return out;
  }

  private async calculateOne(
    req: BatchRateRequest,
  ): Promise<BatchRateLineResult> {
    const resolved = await this.resolver.resolve({
      htsNumber: req.htsCode,
      countryOfOrigin: req.country,
      destinationCountry: 'US',
      entryDate: req.entryDate,
      htsVersion: req.htsVersion,
      certificate: req.certificate,
      selectedChapter99Headings: req.selectedChapter99Headings,
    });

    if (resolved.blocked) {
      return {
        htsCode: req.htsCode,
        country: req.country,
        effectiveHtsCode: resolved.effectiveHtsCode,
        blocked: true,
        blockReason: resolved.blockReason ?? null,
        message: resolved.message,
        totalDuty: 0,
        breakdown: [],
      };
    }

    const inputs = req.inputs || {};
    const baseVars = {
      value: typeof inputs.value === 'number' ? inputs.value : 0,
      weight: typeof inputs.weight === 'number' ? inputs.weight : 0,
      quantity: typeof inputs.quantity === 'number' ? inputs.quantity : 0,
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
      if (!this.shouldEvaluate(c, req)) {
        continue;
      }
      const variables = this.buildScope({
        component: c,
        baseVars,
        additional: inputs,
        duty: runningDuty,
        total: baseVars.value + runningDuty,
      });
      const evaledResult = this.safeEvaluate(c.formula, variables);
      if (evaledResult.error) {
        evaluated.push({ component: c, amount: 0, error: evaledResult.error });
        continue;
      }
      runningDuty += evaledResult.amount;
      evaluated.push({ component: c, amount: evaledResult.amount, error: null });
    }

    const postTariffTotal = baseVars.value + runningDuty;
    let runningFees = 0;
    for (const c of post) {
      if (!this.shouldEvaluate(c, req)) {
        continue;
      }
      const variables = this.buildScope({
        component: c,
        baseVars,
        additional: inputs,
        duty: runningDuty,
        total: postTariffTotal,
      });
      const evaledResult = this.safeEvaluate(c.formula, variables);
      if (evaledResult.error) {
        evaluated.push({ component: c, amount: 0, error: evaledResult.error });
        continue;
      }
      runningFees += evaledResult.amount;
      evaluated.push({ component: c, amount: evaledResult.amount, error: null });
    }

    const totalDuty = runningDuty + runningFees;

    return {
      htsCode: req.htsCode,
      country: req.country,
      effectiveHtsCode: resolved.effectiveHtsCode,
      blocked: false,
      blockReason: null,
      message: resolved.message,
      totalDuty: this.round2(totalDuty),
      breakdown: evaluated.map((e) => ({
        componentType: e.component.componentType,
        tariffType: this.tariffTypeFromComponent(e.component.componentType),
        tariffTypeDescription:
          e.component.description || e.component.componentType,
        amount: this.round2(e.amount),
        formula: e.component.formula,
        formulaVariables: e.component.requiredVariables,
        chapter99HtsCode:
          e.component.componentType === 'chapter_99'
            ? e.component.identifier ?? null
            : null,
        error: e.error,
      })),
    };
  }

  private shouldEvaluate(
    component: TariffFormulaComponent,
    req: BatchRateRequest,
  ): boolean {
    const when = component.appliesWhen;
    if (when.kind === 'always') return true;
    if (when.kind === 'country_in') {
      return when.countries.includes((req.country || '').toUpperCase());
    }
    if (when.kind === 'country_not_in') {
      return !when.countries.includes((req.country || '').toUpperCase());
    }
    if (when.kind === 'requires_chapter99_selection') {
      const selected = new Set(req.selectedChapter99Headings || []);
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
  }): Record<string, number> {
    const scope: Record<string, number> = {
      value: args.baseVars.value,
      weight: args.baseVars.weight,
      quantity: args.baseVars.quantity,
      duty: args.duty,
      total: args.total,
    };

    const declared = new Set(
      args.component.requiredVariables.map((v) => v.name),
    );

    for (const [k, v] of Object.entries(args.additional || {})) {
      if (k === 'value' || k === 'weight' || k === 'quantity') continue;
      if (!declared.has(k)) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      scope[k] = v;
    }

    return scope;
  }

  private safeEvaluate(
    formula: string,
    variables: Record<string, number>,
  ): { amount: number; error: string | null } {
    try {
      const amount = this.evaluator.evaluate(formula, variables);
      return { amount, error: null };
    } catch (error: any) {
      this.logger.warn(
        `Formula evaluation failed for "${formula}": ${error?.message}`,
      );
      return { amount: 0, error: error?.message || 'evaluation error' };
    }
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
}
