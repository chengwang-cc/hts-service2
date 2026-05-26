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
 * Rule: ae.vat.standard — UAE VAT 5% on imports.
 * Native currency: AED. GCC 12-digit national code (W0.5.T1 handles).
 */
@Injectable()
export class AeVatRule implements ExceptionRule {
  readonly id = 'ae.vat.standard';
  readonly destination = 'AE';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'UAE VAT — Standard (5%)';
  readonly priority = 8000;
  readonly knowledgeCardKeys = ['ae.mof.vat-import'];
  isApplicable(ctx: ExceptionRuleContext): boolean { return ctx.destination === 'AE'; }
  declaredInputs(): ExceptionRuleInputSpec[] {
    return [{ name: 'ae_vat_taxable_value', type: 'money', required: false, label: 'VAT base (CIF + duty)' }];
  }
  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    const [base, n] = parseNumericInputWithNote('ae_vat_taxable_value', ctx.additionalInputs['ae_vat_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 });
    if (n) notes.push(n);
    const rate = 0.05;
    const amount = base * rate;
    return {
      add: [{
        componentType: 'post_tax', formula: `${amount}`, rateText: '5% — UAE VAT',
        description: 'UAE VAT @ 5% on CIF + duty.',
        requiredVariables: [{ name: 'ae_vat_taxable_value', type: 'number', dimension: 'money' }],
        identifier: 'AE_VAT_STANDARD', programFamily: 'tax',
        programAuthority: 'UAE Federal Decree-Law No. 8 of 2017', legalReference: 'UAE MOF VAT regulations',
        appliesWhen: { kind: 'always' },
        sourceCitation: { source: 'ae.mof.vat-import', confidence: 1, parserMethod: 'manual' },
        confidence: 1,
      } as TariffFormulaComponent],
      notes, data: { rate, base, amount },
    };
  }
}
