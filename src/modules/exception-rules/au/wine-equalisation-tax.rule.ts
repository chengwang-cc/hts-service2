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
 * Rule: au.wine-equalisation-tax
 * Authority: A New Tax System (Wine Equalisation Tax) Act 1999
 * Scope: Wine and similar (HS 22.04, 22.05, 22.06).
 *
 * Sources:
 *   - ato.wet-overview
 *   - 'WET Act 1999 §5-5'
 *
 * Plain-English summary:
 *   WET = 29% of the (approximate) wholesale value, which for imports
 *   is the customs value uplifted by 50% — i.e., `value * 1.5 * 0.29`.
 *   The 1.5 multiplier is statutory ("notional wholesale" presumption).
 *
 * Conflicts / stacking:
 *   - None. Stacks with import duty and GST.
 *
 * Last reviewed by counsel: PENDING (P5.T12)
 */
@Injectable()
export class AuWineEqualisationTaxRule implements ExceptionRule {
  readonly id = 'au.wine-equalisation-tax';
  readonly destination = 'AU';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'AU Wine Equalisation Tax (WET)';
  readonly priority = 9010;
  readonly knowledgeCardKeys = ['ato.wet-overview'];

  private readonly scopePrefixes = new Set(['2204', '2205', '2206']);

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'AU') return false;
    const p4 = normalizeHts(ctx.htsCode).slice(0, 4);
    return this.scopePrefixes.has(p4);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const component: TariffFormulaComponent = {
      componentType: 'post_tax',
      formula: 'value * 1.5 * 0.29',
      rateText: 'WET 29% on notional wholesale',
      description: 'Wine Equalisation Tax — 29% of notional wholesale (customs value × 1.5).',
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: 'AU_WET_29',
      programFamily: 'tax',
      programAuthority: 'A New Tax System (Wine Equalisation Tax) Act 1999',
      legalReference: 'WET Act 1999 §5-5',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'ATO Wine Equalisation Tax',
        rowIdentifier: 'wet-29',
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component] };
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
