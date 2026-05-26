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
 * Rule: au.excise
 * Authority: Excise Tariff Act 1921
 * Scope: Alcoholic beverages (HS 22.03–22.08 excl. WET-scope wines),
 *        tobacco (HS 24), and certain fuel products (HS 27.10).
 *
 * Sources:
 *   - ato.excise-tariff-act-1921
 *   - ato.excise-rates  (indexed Feb / Aug each year)
 *
 * Plain-English summary:
 *   AU excise on excisable goods is specific (per unit) and indexed
 *   semi-annually. This rule scaffolds three categories with
 *   representative rates as of mid-2025; OPS refreshes from the ATO
 *   index. Imports under HS 87.03 use LCT, not excise.
 *
 *   Categories + representative rates:
 *     - Beer (22.03): AUD 56.84 / Lal (litre of alcohol)
 *     - Spirits (22.08): AUD 103.89 / Lal
 *     - Tobacco (24.02): AUD 1.65 / stick
 *     - Fuel (27.10): AUD 0.499 / litre
 *
 *   Inputs:
 *     - `au_excise_units`: number — litres of alcohol, sticks, or
 *       litres of fuel, depending on category. Required when in scope.
 *
 * Conflicts / stacking:
 *   - WET-scope (22.04–22.06) is handled by au.wine-equalisation-tax;
 *     this rule excludes those prefixes.
 *
 * Last reviewed by counsel: PENDING (P5.T12)
 */
@Injectable()
export class AuExciseRule implements ExceptionRule {
  readonly id = 'au.excise';
  readonly destination = 'AU';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'AU Excise — alcohol, tobacco, fuel';
  readonly priority = 9020;
  readonly knowledgeCardKeys = ['ato.excise-tariff-act-1921', 'ato.excise-rates'];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'AU') return false;
    return this.categoryFor(ctx.htsCode) !== null;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'au_excise_units',
        type: 'number',
        required: false,
        label: 'Excise units (Lal for alcohol, sticks for tobacco, L for fuel)',
        helpRef: 'knowledge:ato.excise-rates',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const category = this.categoryFor(ctx.htsCode);
    if (!category) return {};
    // A1 fix (2026-05-26): reject booleans + parse comma-formatted
    // strings rather than silently Number()-coercing.
    const [units, inputNote] = parseNumericInputWithNote(
      'au_excise_units',
      ctx.additionalInputs['au_excise_units'],
      { min: 0, defaultIfMissing: 0, fallback: 0 },
    );
    const rate = CATEGORY_RATES[category];
    const amount = Math.max(0, units * rate);
    const component: TariffFormulaComponent = {
      componentType: 'post_tax',
      formula: `${amount}`,
      rateText: `${rate} AUD / ${RATE_UNITS[category]} (${category})`,
      description: `Excise on ${category} — AUD ${rate} per ${RATE_UNITS[category]}.`,
      requiredVariables: [
        { name: 'au_excise_units', type: 'number', dimension: undefined as any },
      ],
      identifier: `AU_EXCISE_${category.toUpperCase()}`,
      programFamily: 'tax',
      programAuthority: 'Excise Tariff Act 1921',
      legalReference: `ATO Excise rates table — ${category}`,
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'ATO Excise rates',
        rowIdentifier: category,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    const notes = [`category=${category} units=${units}`];
    if (inputNote) notes.push(inputNote);
    return { add: [component], notes };
  }

  private categoryFor(htsCode: string): keyof typeof CATEGORY_RATES | null {
    const p4 = normalizeHts(htsCode).slice(0, 4);
    if (p4 === '2203') return 'beer';
    if (p4 === '2208') return 'spirits';
    if (p4 === '2402') return 'tobacco';
    if (p4 === '2710') return 'fuel';
    return null;
  }
}

const CATEGORY_RATES = {
  beer: 56.84,
  spirits: 103.89,
  tobacco: 1.65,
  fuel: 0.499,
} as const;

const RATE_UNITS = {
  beer: 'Lal',
  spirits: 'Lal',
  tobacco: 'stick',
  fuel: 'L',
} as const;

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
