import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
} from '../types';
import { makeComponent } from './helpers/component.helper';

/**
 * Rule: us.ieepa.fentanyl-cn
 * Authority: International Emergency Economic Powers Act (IEEPA)
 * Scope: Goods of Chinese origin entered for consumption on/after 2025-02-04.
 *        Initial 10%; raised to 20% on 2025-03-04.
 *
 * Sources:
 *   - fr.eo.14195  — initial IEEPA fentanyl China declaration
 *   - fr.eo.14228  — raised to 20%
 *   - cbp.csms.63988468
 *
 * Plain-English summary:
 *   All Chinese-origin goods imported into the US carry an additional
 *   20% under Chapter 99 9903.01.20. The only exclusions are personal
 *   exemptions and certain humanitarian goods (which we don't model
 *   here — those need separate rules).
 *
 * Conflicts / stacking:
 *   - Stacks with §301, §232, and the reciprocal baseline (all are
 *     additive duties on the goods value). No conflict declared.
 *
 * Last reviewed by counsel: PENDING (P4.T9)
 */
@Injectable()
export class IeepaFentanylCnRule implements ExceptionRule {
  readonly id = 'us.ieepa.fentanyl-cn';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'ieepa';
  readonly title = 'IEEPA Fentanyl — China (+20%)';
  readonly priority = 2800;
  readonly knowledgeCardKeys = ['fr.eo.14195', 'fr.eo.14228', 'cbp.csms.63988468'];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    if (ctx.origin !== 'CN') return false;
    return ctx.asOfDate >= new Date('2025-02-04');
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const rate = ctx.asOfDate >= new Date('2025-03-04') ? 0.20 : 0.10;
    return {
      add: [
        makeComponent({
          chapter99: '9903.01.20',
          formula: `value * ${rate}`,
          rateLabel: `IEEPA Fentanyl China (+${(rate * 100).toFixed(0)}%)`,
          identifier: `IEEPA_FENTANYL_CN_${(rate * 100).toFixed(0)}`,
          programFamily: 'ieepa',
          programAuthority: 'International Emergency Economic Powers Act',
          legalReference: rate === 0.20 ? 'EO 14228' : 'EO 14195',
          description: `IEEPA fentanyl emergency additional duty on Chinese-origin goods (${(rate * 100).toFixed(0)}%).`,
          sourceLabel: 'CBP IEEPA fentanyl program — China',
        }),
      ],
      notes: [`rate=${rate}`],
    };
  }
}
