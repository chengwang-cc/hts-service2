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
 * Rule: gb.steel-safeguard
 * Authority: UK Trade Remedies Authority (TRA) — Steel Safeguard
 * Scope: Steel-scope HTS (HS Ch 72, 73 selected codes) imported into
 *        the UK. TRQ-based: in-quota at 0% additional, over-quota at
 *        25% additional. Extended through 2026-06-30 in latest review.
 *
 * Sources:
 *   - gb.tra.steel-safeguard-extension-2024
 *   - gb.legislation.customs-import-duty-no-7-amendment-2024
 *
 * Plain-English summary:
 *   Within the annual TRQ allocation (per origin country), no
 *   additional duty. Above the quota, +25% applies.
 *
 *   Input: `gb_steel_safeguard_above_quota` (boolean) — operators flip
 *   to true when the calendar-year quota for the origin is exhausted.
 *
 * Conflicts / stacking:
 *   - Sanctions (gb.russia-sanctions) take precedence for Russian-origin
 *     goods via its own `isApplicable()` gating.
 *
 * Last reviewed by counsel: PENDING (P6.T7)
 */
@Injectable()
export class GbSteelSafeguardRule implements ExceptionRule {
  readonly id = 'gb.steel-safeguard';
  readonly destination = 'GB';
  readonly authority: ProgramFamily = 'section_232'; // closest analog
  readonly title = 'UK Steel Safeguard (TRQ + 25% above-quota)';
  readonly priority = 2100;
  readonly knowledgeCardKeys = [
    'gb.tra.steel-safeguard-extension-2024',
    'gb.legislation.customs-import-duty-no-7-amendment-2024',
  ];
  /**
   * D5 fix (2026-05-27): when UK Russia sanctions have fired (priority
   * 2050, runs first), the safeguard MUST NOT additionally stack.
   */
  readonly conflictsWith = ['gb.russia-sanctions'];

  private readonly scopeChapters = new Set(['72', '73']);

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'GB') return false;
    const ch = normalizeHts(ctx.htsCode).slice(0, 2);
    return this.scopeChapters.has(ch);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'gb_steel_safeguard_above_quota',
        type: 'boolean',
        required: false,
        label: 'UK steel TRQ exhausted? (above-quota = +25%)',
        helpRef: 'knowledge:gb.tra.steel-safeguard-extension-2024',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const aboveQuota = Boolean(ctx.additionalInputs['gb_steel_safeguard_above_quota']);
    const rate = aboveQuota ? 0.25 : 0;
    const label = aboveQuota ? 'UK Steel Safeguard (above-quota +25%)' : 'UK Steel Safeguard (in-quota 0%)';
    const component: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: `value * ${rate}`,
      rateText: label,
      description: aboveQuota
        ? 'UK Steel Safeguard above-quota duty (+25%) per TRA extension.'
        : 'UK Steel Safeguard in-quota — zero additional duty.',
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: aboveQuota ? 'GB_STEEL_SAFEGUARD_OVER' : 'GB_STEEL_SAFEGUARD_IN',
      programFamily: 'section_232',
      programAuthority: 'UK Trade Remedies Authority — Steel Safeguard',
      legalReference: 'TRA Steel Safeguard extension 2024',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'UK TRA — Steel Safeguard',
        rowIdentifier: aboveQuota ? 'above-quota' : 'in-quota',
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component], notes: [aboveQuota ? 'above-quota' : 'in-quota'] };
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
