import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';

/**
 * Rule: kr.special-excise-tax (개별소비세)
 * Authority: 개별소비세법 (Individual Consumption Tax Act)
 * Scope: Specific luxury items + select vehicles.
 *
 * Sources:
 *   - kr.nts.individual-consumption-tax-act
 *   - kr.customs.special-excise-rates
 *
 * Plain-English summary:
 *   Specific scope HTS pay 5–20% ad valorem on top of the base duty.
 *   Representative scope + 2025 rates:
 *     - Cars (8703): 5% (decreased from 7%; 3.5% promo 2025)
 *     - Jewelry (7113): 20%
 *     - Perfume (3303): 7%
 *     - Golf equipment (9506.31): 20%
 *     - High-end watches (9101/9102): 20%
 *
 * Conflicts / stacking:
 *   - kr.education-tax fires after this rule and computes 30% of the
 *     emitted special-excise component.
 *
 * Last reviewed by counsel: PENDING (P5.T12)
 */
@Injectable()
export class KrSpecialExciseTaxRule implements ExceptionRule {
  readonly id = 'kr.special-excise-tax';
  readonly destination = 'KR';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'KR Special Excise Tax (개별소비세)';
  readonly priority = 9000;
  readonly knowledgeCardKeys = [
    'kr.nts.individual-consumption-tax-act',
    'kr.customs.special-excise-rates',
  ];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'KR') return false;
    return this.categoryFor(ctx.htsCode) !== null;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const c = this.categoryFor(ctx.htsCode);
    if (!c) return {};
    const component: TariffFormulaComponent = {
      componentType: 'post_tax',
      formula: `value * ${c.rate}`,
      rateText: `${(c.rate * 100).toFixed(1)}% (${c.label})`,
      description: `Individual Consumption Tax (개별소비세) — ${c.label}.`,
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: `KR_ICTAX_${c.key}`,
      programFamily: 'tax',
      programAuthority: '개별소비세법 (Individual Consumption Tax Act)',
      legalReference: 'KR NTS ICTax Act',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'KR NTS — Individual Consumption Tax',
        rowIdentifier: c.key,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component], notes: [`category=${c.key}`] };
  }

  private categoryFor(
    htsCode: string,
  ): { key: string; label: string; rate: number } | null {
    const code = normalizeHts(htsCode);
    const p4 = code.slice(0, 4);
    if (p4 === '8703') return { key: 'CARS', label: 'passenger vehicles', rate: 0.05 };
    if (p4 === '7113') return { key: 'JEWELRY', label: 'jewelry', rate: 0.20 };
    if (p4 === '3303') return { key: 'PERFUME', label: 'perfume', rate: 0.07 };
    if (code.startsWith('950631')) return { key: 'GOLF', label: 'golf equipment', rate: 0.20 };
    if (p4 === '9101' || p4 === '9102') return { key: 'WATCH', label: 'high-end watches', rate: 0.20 };
    return null;
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
