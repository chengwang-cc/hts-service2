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
 * Rule: id.ppn.import — Indonesia PPN (VAT) standard 11% on imports.
 * Native currency: IDR.
 */
@Injectable()
export class IdPpnRule implements ExceptionRule {
  readonly id = 'id.ppn.import';
  readonly destination = 'ID';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'Indonesia PPN — Import (11%)';
  readonly priority = 8000;
  readonly knowledgeCardKeys = ['id.beacukai.ppn-import'];
  isApplicable(ctx: ExceptionRuleContext): boolean { return ctx.destination === 'ID'; }
  declaredInputs(): ExceptionRuleInputSpec[] {
    return [{ name: 'id_ppn_taxable_value', type: 'money', required: false, label: 'PPN base (CIF + duty)' }];
  }
  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    const [base, n] = parseNumericInputWithNote('id_ppn_taxable_value', ctx.additionalInputs['id_ppn_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 });
    if (n) notes.push(n);
    const rate = 0.11;
    const amount = base * rate;
    return {
      add: [{
        componentType: 'post_tax', formula: `${amount}`, rateText: '11% — Indonesia PPN',
        description: 'Indonesia PPN @ 11% on CIF + duty.',
        requiredVariables: [{ name: 'id_ppn_taxable_value', type: 'number', dimension: 'money' }],
        identifier: 'ID_PPN_IMPORT', programFamily: 'tax',
        programAuthority: 'Indonesia PPN Law', legalReference: 'Bea Cukai PPN regulations',
        appliesWhen: { kind: 'always' },
        sourceCitation: { source: 'id.beacukai.ppn-import', confidence: 1, parserMethod: 'manual' },
        confidence: 1,
      } as TariffFormulaComponent],
      notes, data: { rate, base, amount },
    };
  }
}
