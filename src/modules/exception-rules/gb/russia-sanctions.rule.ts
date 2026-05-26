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
 * Rule: gb.russia-sanctions
 * Authority: Russia (Sanctions) (EU Exit) Regulations 2019 (UK)
 * Scope: Russian-origin goods on the UK sanctions list. Two outcomes:
 *   (1) prohibited imports (most categories) — emits a block-style
 *       component with a 100% nominal rate + a clear note that the
 *       goods may not be imported
 *   (2) +35% additional duty on remaining permitted categories
 *
 * Sources:
 *   - gb.legislation.russia-sanctions-2019
 *   - gb.fcdo.russia-import-bans
 *
 * Plain-English summary:
 *   This rule conservatively emits a 35% additional-duty line on any
 *   Russian-origin import into the UK. Operators must verify whether
 *   the specific HS heading is on the import-ban list (separate
 *   compliance check) — the duty calculator is not a substitute for
 *   that legal review.
 *
 * Conflicts / stacking:
 *   - Overrides gb.steel-safeguard for RU origin via declared
 *     conflictsWith.
 *
 * Last reviewed by counsel: PENDING (P6.T7)
 */
@Injectable()
export class GbRussiaSanctionsRule implements ExceptionRule {
  readonly id = 'gb.russia-sanctions';
  readonly destination = 'GB';
  readonly authority: ProgramFamily = 'reciprocal';
  readonly title = 'UK Russia Sanctions (+35% / banned categories)';
  readonly priority = 2050;
  readonly knowledgeCardKeys = [
    'gb.legislation.russia-sanctions-2019',
    'gb.fcdo.russia-import-bans',
  ];
  // D5 fix: conflictsWith now lives on `gb.steel-safeguard` pointing here.
  // Sanctions run first (priority 2050) and unconditionally apply to RU/BY;
  // safeguard short-circuits when sanctions has already fired.

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'GB') return false;
    return ctx.origin === 'RU' || ctx.origin === 'BY';
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const component: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: 'value * 0.35',
      rateText: '+35% UK Russia Sanctions additional duty',
      description:
        'UK Russia/Belarus sanctions — additional 35% duty. NOTE: Many headings are banned outright; verify against the UK FCDO import-ban list before proceeding.',
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: `GB_RUSSIA_SANCTIONS_${ctx.origin}_35`,
      programFamily: 'reciprocal',
      programAuthority: 'Russia (Sanctions) (EU Exit) Regulations 2019',
      legalReference: 'UK SI — Russia Sanctions',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'UK FCDO — Russia Sanctions',
        rowIdentifier: `${ctx.origin}-35`,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component], notes: [`${ctx.origin} sanctioned origin`] };
  }
}
