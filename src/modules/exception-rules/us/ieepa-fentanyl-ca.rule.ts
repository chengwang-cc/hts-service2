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
 * Rule: us.ieepa.fentanyl-ca
 * Authority: International Emergency Economic Powers Act
 * Scope: Goods of Canadian origin entered into the US on/after 2025-03-04.
 *        Energy products (oil, natural gas, electricity) and critical
 *        minerals carry 10%; everything else carries 25%.
 *        USMCA-qualifying goods exempt.
 *
 * Sources:
 *   - fr.eo.14193  — initial IEEPA fentanyl Canada declaration
 *   - fr.eo.14231  — energy carve-out
 *   - cbp.csms.63988470
 *
 * Plain-English summary:
 *   Canadian-origin goods carry an additional 25% under Chapter 99
 *   9903.01.22, OR 10% if energy/critical-mineral (9903.01.23). Both
 *   are exempt when USMCA-qualifying. The energy carve-out is signaled
 *   by the `canada_energy_or_critical_mineral` boolean input.
 *
 * Conflicts / stacking:
 *   - None declared. USMCA exemption is internal logic.
 */
@Injectable()
export class IeepaFentanylCaRule implements ExceptionRule {
  readonly id = 'us.ieepa.fentanyl-ca';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'ieepa';
  readonly title = 'IEEPA Fentanyl — Canada (+25%, energy 10%, USMCA-exempt)';
  readonly priority = 2820;
  readonly knowledgeCardKeys = ['fr.eo.14193', 'fr.eo.14231', 'cbp.csms.63988470'];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    if (ctx.origin !== 'CA') return false;
    if (ctx.asOfDate < new Date('2025-03-04')) return false;
    return !Boolean(ctx.additionalInputs['usmca_qualifying']);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'usmca_qualifying',
        type: 'boolean',
        required: false,
        label: 'USMCA-qualifying? (check if certificate of origin on file)',
        helpRef: 'knowledge:fr.eo.14231#usmca-exemption',
      },
      {
        name: 'canada_energy_or_critical_mineral',
        type: 'boolean',
        required: false,
        label: 'Energy resource or critical mineral? (10% instead of 25%)',
        helpRef: 'knowledge:fr.eo.14231#energy-carveout',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const isEnergy = Boolean(ctx.additionalInputs['canada_energy_or_critical_mineral']);
    const rate = isEnergy ? 0.10 : 0.25;
    const chapter99 = isEnergy ? '9903.01.23' : '9903.01.22';
    return {
      add: [
        makeComponent({
          chapter99,
          formula: `value * ${rate}`,
          rateLabel: `IEEPA Fentanyl Canada (${isEnergy ? 'energy' : 'standard'} +${(rate * 100).toFixed(0)}%)`,
          identifier: isEnergy ? 'IEEPA_FENTANYL_CA_ENERGY_10' : 'IEEPA_FENTANYL_CA_25',
          programFamily: 'ieepa',
          programAuthority: 'International Emergency Economic Powers Act',
          legalReference: isEnergy ? 'EO 14231 §energy' : 'EO 14193',
          description: `IEEPA fentanyl emergency additional duty on Canadian-origin ${isEnergy ? 'energy/critical-mineral' : 'general'} goods.`,
          sourceLabel: 'CBP IEEPA fentanyl program — Canada',
        }),
      ],
      notes: [isEnergy ? 'energy carveout' : 'standard 25%'],
    };
  }
}
