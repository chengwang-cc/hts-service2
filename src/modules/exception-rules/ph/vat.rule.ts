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
 * Rule: ph.vat.import — Philippines VAT (BIR) standard 12% on imports.
 * Native currency: PHP. Base: CIF + customs duty + excise (where applicable).
 */
@Injectable()
export class PhVatRule implements ExceptionRule {
  readonly id = 'ph.vat.import';
  readonly destination = 'PH';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'Philippines VAT — Import (12%)';
  readonly priority = 8000;
  readonly knowledgeCardKeys = ['ph.bir.vat-import'];
  isApplicable(ctx: ExceptionRuleContext): boolean { return ctx.destination === 'PH'; }
  declaredInputs(): ExceptionRuleInputSpec[] {
    return [{ name: 'ph_vat_taxable_value', type: 'money', required: false, label: 'VAT base (CIF + duty + excise)' }];
  }
  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    const [base, n] = parseNumericInputWithNote('ph_vat_taxable_value', ctx.additionalInputs['ph_vat_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 });
    if (n) notes.push(n);
    const rate = 0.12;
    const amount = base * rate;
    return {
      add: [{
        componentType: 'post_tax', formula: `${amount}`, rateText: '12% — Philippines VAT',
        description: 'Philippines VAT @ 12% on CIF + duty + excise.',
        requiredVariables: [{ name: 'ph_vat_taxable_value', type: 'number', dimension: 'money' }],
        identifier: 'PH_VAT_IMPORT', programFamily: 'tax',
        programAuthority: 'Philippines VAT Law', legalReference: 'BIR VAT regulations',
        appliesWhen: { kind: 'always' },
        sourceCitation: { source: 'ph.bir.vat-import', confidence: 1, parserMethod: 'manual' },
        confidence: 1,
      } as TariffFormulaComponent],
      notes,
      data: { rate, base, amount },
    };
  }
}
