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
 * Rule: us.ieepa.fentanyl-mx
 * Authority: International Emergency Economic Powers Act
 * Scope: Goods of Mexican origin entered into the US on/after 2025-03-04.
 *
 * Sources:
 *   - fr.eo.14194  — initial IEEPA fentanyl Mexico declaration (Feb 2025)
 *   - fr.eo.14227  — exemption details for USMCA-qualifying goods
 *   - cbp.csms.63988469
 *
 * Plain-English summary:
 *   Mexican-origin goods carry an additional 25% under Chapter 99
 *   9903.01.21, UNLESS the goods qualify under USMCA (`usmca_qualifying`
 *   input is true and a certification is on file).
 *
 *   The check is done in `isApplicable()` so a non-qualifying entry
 *   triggers the rule and a qualifying entry does not — operators can
 *   then verify the carve-out from the audit log (firedRules list).
 *
 * Conflicts / stacking:
 *   - None declared. USMCA exemption is internal logic, not a
 *     conflictsWith with the USMCA rule.
 *
 * Last reviewed by counsel: PENDING (P4.T9)
 */
@Injectable()
export class IeepaFentanylMxRule implements ExceptionRule {
  readonly id = 'us.ieepa.fentanyl-mx';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'ieepa';
  readonly title = 'IEEPA Fentanyl — Mexico (+25%, USMCA-exempt)';
  readonly priority = 2810;
  readonly knowledgeCardKeys = ['fr.eo.14194', 'fr.eo.14227', 'cbp.csms.63988469'];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    if (ctx.origin !== 'MX') return false;
    if (ctx.asOfDate < new Date('2025-03-04')) return false;
    const usmca = Boolean(ctx.additionalInputs['usmca_qualifying']);
    return !usmca;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'usmca_qualifying',
        type: 'boolean',
        required: false,
        label: 'USMCA-qualifying? (check if certificate of origin on file)',
        helpRef: 'knowledge:fr.eo.14227#usmca-exemption',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    return {
      add: [
        makeComponent({
          chapter99: '9903.01.21',
          formula: 'value * 0.25',
          rateLabel: 'IEEPA Fentanyl Mexico (+25%)',
          identifier: 'IEEPA_FENTANYL_MX_25',
          programFamily: 'ieepa',
          programAuthority: 'International Emergency Economic Powers Act',
          legalReference: 'EO 14194; EO 14227',
          description: 'IEEPA fentanyl emergency additional duty on Mexican-origin goods (25%).',
          sourceLabel: 'CBP IEEPA fentanyl program — Mexico',
        }),
      ],
    };
  }
}
