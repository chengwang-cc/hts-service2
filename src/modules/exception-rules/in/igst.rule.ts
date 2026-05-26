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
 * Rule: in.gst.igst-import
 * Authority: India CGST Act + IGST Act
 * Scope: Integrated GST on every taxable import.
 *
 * Standard rates: 5%, 12%, 18%, 28% (HS-driven).
 * Base formula: CIF_PLUS_DUTY_PLUS_FEES (includes BCD + SWS + any
 * other customs duties + landing charges).
 * Native currency: INR.
 *
 * For W1: this rule applies a 18% default. Production deployment needs
 * OPS to ingest the CBIC GST rate schedule (`cbic-gst.gov.in/gst-goods-
 * services-rates.html`) into a per-HTS lookup table.
 */
@Injectable()
export class InIgstImportRule implements ExceptionRule {
  readonly id = 'in.gst.igst-import';
  readonly destination = 'IN';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'India IGST — Import';
  readonly priority = 8000;
  readonly knowledgeCardKeys = ['in.cbic.gst-rates'];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    return ctx.destination === 'IN';
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'in_igst_taxable_value',
        type: 'money',
        required: false,
        label: 'IGST base (CIF + BCD + SWS + landing charges)',
      },
      {
        name: 'in_igst_rate_override',
        type: 'percent',
        required: false,
        label: 'IGST rate (% — 5/12/18/28; default 18)',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    const [base, baseNote] = parseNumericInputWithNote(
      'in_igst_taxable_value',
      ctx.additionalInputs['in_igst_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 },
    );
    if (baseNote) notes.push(baseNote);

    const [overrideRate, rateNote] = parseNumericInputWithNote(
      'in_igst_rate_override',
      ctx.additionalInputs['in_igst_rate_override'],
      { min: 0, max: 100, defaultIfMissing: 18, fallback: 18 },
    );
    if (rateNote) notes.push(rateNote);
    const rate = overrideRate / 100;
    const amount = base * rate;

    return {
      add: [
        {
          componentType: 'post_tax',
          formula: `${amount}`,
          rateText: `${(rate * 100).toFixed(0)}% — India IGST`,
          description: `India IGST @ ${(rate * 100).toFixed(0)}% on CIF + BCD + SWS base.`,
          requiredVariables: [
            { name: 'in_igst_taxable_value', type: 'number', dimension: 'money' },
          ],
          identifier: 'IN_IGST_IMPORT',
          programFamily: 'tax',
          programAuthority: 'India IGST Act',
          legalReference: 'CBIC GST Rates Schedule',
          appliesWhen: { kind: 'always' },
          sourceCitation: {
            source: 'in.cbic.gst-rates',
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
}
