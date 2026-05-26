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
 * Rule: my.sales-tax.import — Malaysia Sales Tax (SST) on imports.
 * Default 10% (some categories 5%). Native currency: MYR.
 */
@Injectable()
export class MySalesTaxRule implements ExceptionRule {
  readonly id = 'my.sales-tax.import';
  readonly destination = 'MY';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'Malaysia Sales Tax — Import';
  readonly priority = 8000;
  readonly knowledgeCardKeys = ['my.mysst.import'];
  isApplicable(ctx: ExceptionRuleContext): boolean { return ctx.destination === 'MY'; }
  declaredInputs(): ExceptionRuleInputSpec[] {
    return [{ name: 'my_sst_taxable_value', type: 'money', required: false, label: 'Sales tax base (CIF + duty)' }];
  }
  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    const [base, n] = parseNumericInputWithNote('my_sst_taxable_value', ctx.additionalInputs['my_sst_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 });
    if (n) notes.push(n);
    const rate = 0.10;
    const amount = base * rate;
    return {
      add: [{
        componentType: 'post_tax', formula: `${amount}`, rateText: '10% — Malaysia SST',
        description: 'Malaysia Sales Tax @ 10% on CIF + duty.',
        requiredVariables: [{ name: 'my_sst_taxable_value', type: 'number', dimension: 'money' }],
        identifier: 'MY_SST_IMPORT', programFamily: 'tax',
        programAuthority: 'Malaysia Sales Tax Act 2018', legalReference: 'MySST orders',
        appliesWhen: { kind: 'always' },
        sourceCitation: { source: 'my.mysst.import', confidence: 1, parserMethod: 'manual' },
        confidence: 1,
      } as TariffFormulaComponent],
      notes, data: { rate, base, amount },
    };
  }
}
