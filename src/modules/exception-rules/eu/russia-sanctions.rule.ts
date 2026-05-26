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
 * Rule: eu.russia-sanctions
 * Authority: Council Regulation (EU) No 833/2014 (consolidated).
 * Scope: Russian and Belarusian origin goods.
 *
 * Sources:
 *   - eu.council.reg-833-2014
 *   - eu.commission.russia-belarus-import-bans
 *
 * Plain-English summary:
 *   Many headings are banned outright; others carry punitive duties.
 *   The rule emits a +35% additional-duty line as a conservative
 *   placeholder; operators must consult the EU sanctions register to
 *   confirm whether the specific HS is permitted at all.
 *
 * Conflicts / stacking:
 *   - Overrides eu.steel-safeguard for RU/BY origin via conflictsWith.
 *
 * Last reviewed by counsel: PENDING (P6.T7)
 */
@Injectable()
export class EuRussiaSanctionsRule implements ExceptionRule {
  readonly id = 'eu.russia-sanctions';
  readonly destination = 'EU';
  readonly authority: ProgramFamily = 'reciprocal';
  readonly title = 'EU Russia/Belarus Sanctions (+35% / banned categories)';
  readonly priority = 2050;
  readonly knowledgeCardKeys = [
    'eu.council.reg-833-2014',
    'eu.commission.russia-belarus-import-bans',
  ];
  // D5 fix: the conflictsWith now lives on `eu.steel-safeguard` pointing
  // here. Sanctions run first (priority 2050) and unconditionally apply
  // to RU/BY; safeguard short-circuits when sanctions has already fired.

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'EU') return false;
    return ctx.origin === 'RU' || ctx.origin === 'BY';
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const component: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: 'value * 0.35',
      rateText: '+35% EU Russia Sanctions additional duty',
      description:
        'EU Russia/Belarus sanctions — additional 35% duty. NOTE: Many headings are banned outright; verify against the EU sanctions register before proceeding.',
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: `EU_RUSSIA_SANCTIONS_${ctx.origin}_35`,
      programFamily: 'reciprocal',
      programAuthority: 'Council Regulation (EU) No 833/2014',
      legalReference: 'Reg. 833/2014 (consolidated)',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'EU Commission — Russia Sanctions',
        rowIdentifier: `${ctx.origin}-35`,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component] };
  }
}
