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
 * Rule: vn.vat.import
 * Authority: Vietnam VAT Law
 * Standard 10%; reduced 5% / 8% for select categories.
 * Native currency: VND.
 */
@Injectable()
export class VnVatRule implements ExceptionRule {
  readonly id = 'vn.vat.import';
  readonly destination = 'VN';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'Vietnam VAT — Import';
  readonly priority = 8000;
  readonly knowledgeCardKeys = ['vn.tradeportal.vat-import'];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    return ctx.destination === 'VN';
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      { name: 'vn_vat_taxable_value', type: 'money', required: false, label: 'VAT base (CIF + import duty)' },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    const [base, n] = parseNumericInputWithNote(
      'vn_vat_taxable_value',
      ctx.additionalInputs['vn_vat_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 },
    );
    if (n) notes.push(n);
    const rate = 0.10;
    const amount = base * rate;
    return {
      add: [
        {
          componentType: 'post_tax',
          formula: `${amount}`,
          rateText: '10% — Vietnam VAT',
          description: 'Vietnam VAT @ 10% on CIF + import duty.',
          requiredVariables: [{ name: 'vn_vat_taxable_value', type: 'number', dimension: 'money' }],
          identifier: 'VN_VAT_IMPORT',
          programFamily: 'tax',
          programAuthority: 'Vietnam VAT Law',
          legalReference: 'Vietnam Trade Portal — VAT references',
          appliesWhen: { kind: 'always' },
          sourceCitation: { source: 'vn.tradeportal.vat-import', confidence: 1, parserMethod: 'manual' },
          confidence: 1,
        } as TariffFormulaComponent,
      ],
      notes,
      data: { rate, base, amount },
    };
  }
}
