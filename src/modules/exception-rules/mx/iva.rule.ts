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
 * Rule: mx.iva.standard
 * Authority: Ley del Impuesto al Valor Agregado (Mexico IVA)
 * Scope: Standard IVA on imports — 16% (8% in northern border zone).
 *
 * Base formula: CIF + IGI + DTA + other contributions.
 * Native currency: MXN.
 *
 * Inputs:
 *   - mx_iva_taxable_value (money, optional): explicit IVA base. When
 *     missing, the rule defaults to `declaredValue` and emits a warning
 *     ("IVA base should include CIF + IGI + DTA — defaulted to goods value").
 *   - mx_border_zone (boolean, optional): northern border zone flag
 *     enabling the 8% reduced rate.
 */
@Injectable()
export class MxIvaRule implements ExceptionRule {
  readonly id = 'mx.iva.standard';
  readonly destination = 'MX';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'Mexico IVA — Standard (16%) / Border zone (8%)';
  readonly priority = 8000;
  readonly knowledgeCardKeys = [
    'mx.sat.iva-import-base',
    'mx.sat.ley-iva',
  ];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    return ctx.destination === 'MX';
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'mx_iva_taxable_value',
        type: 'money',
        required: false,
        label: 'IVA base (CIF + IGI + DTA + other contributions)',
        helpRef: 'knowledge:mx.sat.iva-import-base',
      },
      {
        name: 'mx_border_zone',
        type: 'boolean',
        required: false,
        label: 'Northern border zone (8% reduced rate)?',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    const [base, inputNote] = parseNumericInputWithNote(
      'mx_iva_taxable_value',
      ctx.additionalInputs['mx_iva_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 },
    );
    if (inputNote) notes.push(inputNote);

    const isBorder = Boolean(ctx.additionalInputs['mx_border_zone']);
    const rate = isBorder ? 0.08 : 0.16;
    const amount = base * rate;

    const component: TariffFormulaComponent = {
      componentType: 'post_tax',
      formula: `${amount}`,
      rateText: `${(rate * 100).toFixed(0)}% — Mexico IVA${isBorder ? ' (Border zone)' : ''}`,
      description: `Mexico IVA @ ${(rate * 100).toFixed(0)}% on CIF + IGI + DTA base.`,
      requiredVariables: [
        { name: 'mx_iva_taxable_value', type: 'number', dimension: 'money' },
      ],
      identifier: isBorder ? 'MX_IVA_BORDER' : 'MX_IVA_STANDARD',
      programFamily: 'tax',
      programAuthority: 'Ley del Impuesto al Valor Agregado',
      legalReference: 'SAT — Ley del IVA Art. 27',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'mx.sat.iva-import-base',
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };

    notes.push(`base=${base} rate=${rate}`);
    return {
      add: [component],
      notes,
      data: { rate, base, amount, borderZone: isBorder },
    };
  }
}
