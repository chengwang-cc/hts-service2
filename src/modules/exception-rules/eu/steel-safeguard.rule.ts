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
 * Rule: eu.steel-safeguard
 * Authority: EU Commission Implementing Regulation 2019/159 (extended).
 * Scope: Steel-scope HTS (Ch 72/73 subset) imported into the EU. TRQ
 *        with 25% over-quota.
 *
 * Sources:
 *   - eu.commission.regulation-2019-159
 *   - eu.commission.steel-safeguard-extension-2024
 *
 * Conflicts / stacking:
 *   - Russia sanctions take precedence via `eu.russia-sanctions`.
 *
 * Last reviewed by counsel: PENDING (P6.T7)
 */
@Injectable()
export class EuSteelSafeguardRule implements ExceptionRule {
  readonly id = 'eu.steel-safeguard';
  readonly destination = 'EU';
  readonly authority: ProgramFamily = 'section_232';
  readonly title = 'EU Steel Safeguard (TRQ + 25% above-quota)';
  readonly priority = 2100;
  readonly knowledgeCardKeys = [
    'eu.commission.regulation-2019-159',
    'eu.commission.steel-safeguard-extension-2024',
  ];
  /**
   * D5 fix (2026-05-27): when EU Russia sanctions have fired (priority
   * 2050, runs first), the safeguard MUST NOT additionally stack —
   * sanctions already encode the punitive duty. Without this guard,
   * RU steel into EU would carry +35% sanctions AND +25% safeguard
   * simultaneously.
   */
  readonly conflictsWith = ['eu.russia-sanctions'];

  private readonly scopeChapters = new Set(['72', '73']);

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'EU') return false;
    const ch = normalizeHts(ctx.htsCode).slice(0, 2);
    return this.scopeChapters.has(ch);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'eu_steel_safeguard_above_quota',
        type: 'boolean',
        required: false,
        label: 'EU steel TRQ exhausted? (above-quota = +25%)',
        helpRef: 'knowledge:eu.commission.steel-safeguard-extension-2024',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const aboveQuota = Boolean(ctx.additionalInputs['eu_steel_safeguard_above_quota']);
    const rate = aboveQuota ? 0.25 : 0;
    const component: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: `value * ${rate}`,
      rateText: aboveQuota ? 'EU Steel Safeguard (above-quota +25%)' : 'EU Steel Safeguard (in-quota 0%)',
      description: aboveQuota
        ? 'EU Steel Safeguard above-quota duty (+25%).'
        : 'EU Steel Safeguard in-quota — zero additional duty.',
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: aboveQuota ? 'EU_STEEL_SAFEGUARD_OVER' : 'EU_STEEL_SAFEGUARD_IN',
      programFamily: 'section_232',
      programAuthority: 'EU Commission Implementing Regulation 2019/159',
      legalReference: 'Reg. 2019/159 (extended)',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'EU Commission — Steel Safeguard',
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
