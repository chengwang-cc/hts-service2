import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import { parseNumericInputWithNote } from '../_shared/numeric-input';

/**
 * Rule: jp.consumption-tax.standard
 * Authority: Japan Consumption Tax Act
 * Scope: All taxable imports into Japan.
 *
 * Base formula: CIF_PLUS_DUTY (the consumption-tax base includes the
 * customs value + import duty + any internal taxes already assessed).
 * Standard rate: 10% (reduced 8% for select food/beverage items —
 * scope-driven by HS chapter prefix).
 *
 * Native currency: JPY. F2-style currency-mix warning is emitted by
 * the quote service when the quote currency isn't JPY.
 *
 * Inputs:
 *   - jp_consumption_tax_taxable_value (number, required): the
 *     consumption-tax base. Required because the calculator can't
 *     compute it from `declaredValue` alone — it needs to include
 *     duty + internal taxes already stacked.
 *
 * Sources:
 *   - jp.customs.consumption-tax-outline
 *   - jp.nta.consumption-tax-act
 *
 * W0.5/Wave-1 placeholder note:
 *   This rule ships with documented behavior; production deployment
 *   needs OPS to ingest the current rate schedule into a knowledge card
 *   and validate the reduced-rate scope mapping against the latest
 *   Japan Customs guidance.
 */
@Injectable()
export class JpConsumptionTaxRule implements ExceptionRule {
  readonly id = 'jp.consumption-tax.standard';
  readonly destination = 'JP';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'Japan Consumption Tax — Standard (10%) / Reduced (8%)';
  /** Jurisdiction-tax band. */
  readonly priority = 8000;
  readonly knowledgeCardKeys = [
    'jp.customs.consumption-tax-outline',
    'jp.nta.consumption-tax-act',
  ];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    return ctx.destination === 'JP';
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'jp_consumption_tax_taxable_value',
        type: 'money',
        required: false,
        label: 'Consumption tax base (CIF + customs duty + internal taxes)',
        helpRef: 'knowledge:jp.customs.consumption-tax-outline#base',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    // A1: never raw Number() — always go through the helper.
    const [base, inputNote] = parseNumericInputWithNote(
      'jp_consumption_tax_taxable_value',
      ctx.additionalInputs['jp_consumption_tax_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 },
    );
    if (inputNote) notes.push(inputNote);

    const rate = this.rateForHts(ctx.htsCode);
    const amount = base * rate;

    const component: TariffFormulaComponent = {
      // B1: jurisdiction taxes land in totals.taxes — must be post_tax.
      componentType: 'post_tax',
      formula: `${amount}`,
      rateText: `${(rate * 100).toFixed(0)}% — Japan Consumption Tax`,
      description: `Japan Consumption Tax @ ${(rate * 100).toFixed(0)}% on CIF + duty base.`,
      requiredVariables: [
        { name: 'jp_consumption_tax_taxable_value', type: 'number', dimension: 'money' },
      ],
      identifier: 'JP_CONSUMPTION_TAX',
      programFamily: 'tax',
      programAuthority: 'Japan Consumption Tax Act',
      legalReference: 'Japan Customs — Outline of Tariff and Taxes on Imports',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'jp.customs.consumption-tax-outline',
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };

    notes.push(`base=${base} rate=${rate}`);
    return {
      add: [component],
      notes,
      // C2/C3: structured payload for downstream (audit / persistence).
      data: { rate, base, amount, isReducedRate: rate < 0.10 },
    };
  }

  /**
   * Reduced 8% rate for select food/beverage items (HS chapters 02-04,
   * 07-12, 15-21 — broad heuristic; per-product scope needs OPS-curated
   * data). Standard 10% otherwise.
   */
  private rateForHts(htsCode: string): number {
    const ch2 = (htsCode || '').replace(/\./g, '').slice(0, 2);
    const reduced = new Set([
      '02', '03', '04', '07', '08', '09', '10', '11', '12',
      '15', '16', '17', '18', '19', '20', '21',
    ]);
    return reduced.has(ch2) ? 0.08 : 0.10;
  }
}
