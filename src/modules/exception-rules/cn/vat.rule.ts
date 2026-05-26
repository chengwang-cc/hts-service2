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
 * Rule: cn.vat.import
 * Authority: China VAT (Increased Value Tax on imports)
 * Standard 13%; reduced 9% for select categories (food/agri, books/
 * printed material, gas/water/electricity); 6% for select services
 * (irrelevant for goods imports).
 *
 * Base formula: CIF + customs duty + consumption tax (where applicable).
 * Native currency: CNY.
 */
@Injectable()
export class CnVatRule implements ExceptionRule {
  readonly id = 'cn.vat.import';
  readonly destination = 'CN';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'China VAT — Import (13% / 9%)';
  readonly priority = 8000;
  readonly knowledgeCardKeys = ['cn.gacc.vat-import', 'cn.chinatax.vat-regs'];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    return ctx.destination === 'CN';
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'cn_vat_taxable_value',
        type: 'money',
        required: false,
        label: 'VAT base (CIF + import duty + consumption tax)',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    const [base, inputNote] = parseNumericInputWithNote(
      'cn_vat_taxable_value',
      ctx.additionalInputs['cn_vat_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 },
    );
    if (inputNote) notes.push(inputNote);

    const rate = this.rateForHts(ctx.htsCode);
    const amount = base * rate;

    return {
      add: [
        {
          componentType: 'post_tax',
          formula: `${amount}`,
          rateText: `${(rate * 100).toFixed(0)}% — China Import VAT`,
          description: `China Import VAT @ ${(rate * 100).toFixed(0)}%.`,
          requiredVariables: [
            { name: 'cn_vat_taxable_value', type: 'number', dimension: 'money' },
          ],
          identifier: 'CN_VAT_IMPORT',
          programFamily: 'tax',
          programAuthority: 'PRC VAT Implementing Regulations',
          legalReference: 'GACC import duty regulations + State Taxation Administration',
          appliesWhen: { kind: 'always' },
          sourceCitation: {
            source: 'cn.gacc.vat-import',
            confidence: 1,
            parserMethod: 'manual',
          },
          confidence: 1,
        } as TariffFormulaComponent,
      ],
      notes,
      data: { rate, base, amount },
    };
  }

  /** 9% reduced rate for food/agri, books, energy; 13% otherwise. */
  private rateForHts(htsCode: string): number {
    const ch2 = (htsCode || '').replace(/\./g, '').slice(0, 2);
    const reduced = new Set([
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
      '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24',
      '49',           // printed books
      '27',           // mineral fuels
    ]);
    return reduced.has(ch2) ? 0.09 : 0.13;
  }
}
