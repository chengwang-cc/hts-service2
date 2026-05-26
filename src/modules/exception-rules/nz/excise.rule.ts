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
 * Rule: nz.excise
 * Authority: Customs and Excise Act 2018
 * Scope: Alcohol (22.03–22.08), tobacco (24.02–24.03), fuel (27.10).
 *
 * Sources:
 *   - nz.customs.excise-rates
 *   - nz.legislation.customs-and-excise-act-2018
 *
 * Plain-English summary:
 *   Specific NZ-dollar rates per unit. Indexed annually for inflation.
 *   Representative 2025 rates:
 *     - Beer (22.03): NZD 35.05 / Lal
 *     - Spirits (22.08): NZD 60.81 / Lal
 *     - Cigarettes (24.02): NZD 1.34 / stick
 *     - Petrol (27.10): NZD 0.77 / L
 *
 *   Input: `nz_excise_units` — Lal / sticks / L
 *
 * Conflicts / stacking:
 *   - Stacks with GST (computed on VoTI by NZ adapter).
 *
 * Last reviewed by counsel: PENDING (P5.T12)
 */
@Injectable()
export class NzExciseRule implements ExceptionRule {
  readonly id = 'nz.excise';
  readonly destination = 'NZ';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'NZ Excise — alcohol/tobacco/fuel';
  readonly priority = 9000;
  readonly knowledgeCardKeys = [
    'nz.customs.excise-rates',
    'nz.legislation.customs-and-excise-act-2018',
  ];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'NZ') return false;
    return this.categoryFor(ctx.htsCode) !== null;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'nz_excise_units',
        type: 'number',
        required: false,
        label: 'Excise units (Lal/sticks/L per category)',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const c = this.categoryFor(ctx.htsCode);
    if (!c) return {};
    // A1 fix (2026-05-26): reject booleans + parse comma-formatted strings.
    const [units, inputNote] = parseNumericInputWithNote(
      'nz_excise_units',
      ctx.additionalInputs['nz_excise_units'],
      { min: 0, defaultIfMissing: 0, fallback: 0 },
    );
    const amount = Math.max(0, units * c.rate);
    const component: TariffFormulaComponent = {
      componentType: 'post_tax',
      formula: `${amount}`,
      rateText: `NZD ${c.rate} / ${c.unit} (${c.label})`,
      description: `New Zealand excise on ${c.label}.`,
      requiredVariables: [],
      identifier: `NZ_EXCISE_${c.key}`,
      programFamily: 'tax',
      programAuthority: 'Customs and Excise Act 2018',
      legalReference: 'NZ Customs Excise Rates Schedule',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'NZ Customs — Excise rates',
        rowIdentifier: c.key,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    const notes = [`category=${c.key} units=${units}`];
    if (inputNote) notes.push(inputNote);
    return { add: [component], notes };
  }

  private categoryFor(
    htsCode: string,
  ): { key: string; label: string; rate: number; unit: string } | null {
    const p4 = (htsCode || '').replace(/\./g, '').padEnd(10, '0').slice(0, 4);
    if (p4 === '2203') return { key: 'BEER', label: 'beer', rate: 35.05, unit: 'Lal' };
    if (p4 === '2208') return { key: 'SPIRITS', label: 'spirits', rate: 60.81, unit: 'Lal' };
    if (p4 === '2402') return { key: 'CIGARETTES', label: 'cigarettes', rate: 1.34, unit: 'stick' };
    if (p4 === '2710') return { key: 'PETROL', label: 'petrol/fuel', rate: 0.77, unit: 'L' };
    return null;
  }
}
