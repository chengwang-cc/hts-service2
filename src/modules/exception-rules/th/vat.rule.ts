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
 * Rule: th.vat.import — Thailand VAT standard 7% on imports.
 * Native currency: THB.
 */
@Injectable()
export class ThVatRule implements ExceptionRule {
  readonly id = 'th.vat.import';
  readonly destination = 'TH';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'Thailand VAT — Import (7%)';
  readonly priority = 8000;
  readonly knowledgeCardKeys = ['th.customs.vat-import'];
  isApplicable(ctx: ExceptionRuleContext): boolean { return ctx.destination === 'TH'; }
  declaredInputs(): ExceptionRuleInputSpec[] {
    return [{ name: 'th_vat_taxable_value', type: 'money', required: false, label: 'VAT base (CIF + duty + excise)' }];
  }
  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    const [base, n] = parseNumericInputWithNote('th_vat_taxable_value', ctx.additionalInputs['th_vat_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 });
    if (n) notes.push(n);
    const rate = 0.07;
    const amount = base * rate;
    return {
      add: [{
        componentType: 'post_tax', formula: `${amount}`, rateText: '7% — Thailand VAT',
        description: 'Thailand VAT @ 7% on CIF + duty + excise.',
        requiredVariables: [{ name: 'th_vat_taxable_value', type: 'number', dimension: 'money' }],
        identifier: 'TH_VAT_IMPORT', programFamily: 'tax',
        programAuthority: 'Thailand Revenue Code', legalReference: 'Thai Customs VAT references',
        appliesWhen: { kind: 'always' },
        sourceCitation: { source: 'th.customs.vat-import', confidence: 1, parserMethod: 'manual' },
        confidence: 1,
      } as TariffFormulaComponent],
      notes, data: { rate, base, amount },
    };
  }
}
