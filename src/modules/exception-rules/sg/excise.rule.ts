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
 * Rule: sg.excise
 * Authority: Customs Act + Excise Duty Order
 * Scope: Singapore is a free port; the only dutiable categories are
 *        alcohol, tobacco, motor vehicles, and petroleum.
 *
 * Sources:
 *   - sg.customs.excise-duty-order
 *   - sg.customs.dutiable-goods-list
 *
 * Plain-English summary:
 *   Specific rates per L / per kg / per L (depending on category). The
 *   rule emits the appropriate per-unit excise component when the HTS
 *   matches one of the four dutiable categories.
 *
 *   Categories + representative 2025 rates:
 *     - Spirits (22.08): SGD 88 / litre of alcohol
 *     - Beer/stout (22.03): SGD 60 / Lal
 *     - Tobacco (24.02): SGD 491.40 / kg (or per stick equivalent)
 *     - Petroleum (27.10): SGD 0.79 / L
 *     - Motor vehicles (87.03): 20% additional registration fee
 *       (modeled here as ad valorem; vehicle excise is registration-
 *       linked and the import-day component is simpler than the
 *       full LTA scheme)
 *
 *   Inputs:
 *     - `sg_excise_units`: number — Lal / kg / L per category
 *
 * Conflicts / stacking:
 *   - Stacks with GST (computed on CIF + duty by SG adapter).
 *
 * Last reviewed by counsel: PENDING (P5.T12)
 */
@Injectable()
export class SgExciseRule implements ExceptionRule {
  readonly id = 'sg.excise';
  readonly destination = 'SG';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'SG Excise — alcohol/tobacco/petroleum/vehicles';
  readonly priority = 9000;
  readonly knowledgeCardKeys = [
    'sg.customs.excise-duty-order',
    'sg.customs.dutiable-goods-list',
  ];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'SG') return false;
    return this.categoryFor(ctx.htsCode) !== null;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'sg_excise_units',
        type: 'number',
        required: false,
        label: 'Excise units (Lal/kg/L per category)',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const c = this.categoryFor(ctx.htsCode);
    if (!c) return {};
    // A1 fix (2026-05-26): reject booleans + parse comma-formatted strings.
    const [units, inputNote] = parseNumericInputWithNote(
      'sg_excise_units',
      ctx.additionalInputs['sg_excise_units'],
      { min: 0, defaultIfMissing: 0, fallback: 0 },
    );
    const amount = c.adValorem ? 0 : Math.max(0, units * c.rate);
    const formula = c.adValorem ? `value * ${c.rate}` : `${amount}`;
    const component: TariffFormulaComponent = {
      componentType: 'post_tax',
      formula,
      rateText: c.adValorem
        ? `${(c.rate * 100).toFixed(0)}% (${c.label})`
        : `SGD ${c.rate} / ${c.unit} (${c.label})`,
      description: `Singapore excise on ${c.label}.`,
      requiredVariables: c.adValorem
        ? [{ name: 'value', type: 'number', dimension: 'money' }]
        : [],
      identifier: `SG_EXCISE_${c.key}`,
      programFamily: 'tax',
      programAuthority: 'Customs Act + Excise Duty Order',
      legalReference: 'SG Customs — Dutiable Goods Order',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'SG Customs Excise Duty Order',
        rowIdentifier: c.key,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    const notes = [`category=${c.key}`];
    if (inputNote) notes.push(inputNote);
    return { add: [component], notes };
  }

  private categoryFor(htsCode: string): SgExciseCategory | null {
    const p4 = normalizeHts(htsCode).slice(0, 4);
    if (p4 === '2208') return { key: 'SPIRITS', label: 'spirits', rate: 88, unit: 'Lal', adValorem: false };
    if (p4 === '2203') return { key: 'BEER', label: 'beer/stout', rate: 60, unit: 'Lal', adValorem: false };
    if (p4 === '2402') return { key: 'TOBACCO', label: 'tobacco', rate: 491.4, unit: 'kg', adValorem: false };
    if (p4 === '2710') return { key: 'PETROLEUM', label: 'petroleum', rate: 0.79, unit: 'L', adValorem: false };
    if (p4 === '8703') return { key: 'VEHICLES', label: 'motor vehicles', rate: 0.20, unit: '', adValorem: true };
    return null;
  }
}

interface SgExciseCategory {
  key: string;
  label: string;
  rate: number;
  unit: string;
  adValorem: boolean;
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
