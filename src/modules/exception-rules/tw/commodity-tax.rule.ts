import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import { parseNumericInput } from '../_shared/numeric-input';

/**
 * Rule: tw.commodity-tax
 * Authority: 貨物稅條例 (Commodity Tax Act)
 * Scope: Vehicles (87.03 by engine size), refrigerators, AC, dehumidifiers,
 *        TVs, cement, beverages, rubber tires, glass.
 *
 * Sources:
 *   - tw.mof.commodity-tax-act
 *   - tw.mof.commodity-tax-rates-2025
 *
 * Plain-English summary:
 *   Specific commodity-tax categories pay an ad valorem rate on import.
 *   Categories + representative 2025 rates:
 *     - Passenger vehicles ≤2000cc (87.03 with displacement input):
 *       25% ad valorem (15% for hybrid/PHEV/EV per 2025 amendments)
 *     - Vehicles >2000cc: 30% ad valorem
 *     - Refrigerators (8418): 13%
 *     - AC (8415): 20%
 *     - Cement (2523): 10%
 *     - Beverages (2202): 8% if sugared
 *     - Tires (4011): 10%
 *     - Glass (7003): 10%
 *
 *   Inputs:
 *     - `tw_vehicle_displacement_cc`: int — required for HS 87.03 lines
 *       to select the correct vehicle rate band.
 *
 * Conflicts / stacking:
 *   - Stacks with VAT (computed on duty+commodity tax by TW adapter).
 *
 * Last reviewed by counsel: PENDING (P5.T12)
 */
@Injectable()
export class TwCommodityTaxRule implements ExceptionRule {
  readonly id = 'tw.commodity-tax';
  readonly destination = 'TW';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'TW Commodity Tax (貨物稅)';
  readonly priority = 9000;
  readonly knowledgeCardKeys = [
    'tw.mof.commodity-tax-act',
    'tw.mof.commodity-tax-rates-2025',
  ];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'TW') return false;
    return this.categoryFor(ctx) !== null;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'tw_vehicle_displacement_cc',
        type: 'int',
        required: false,
        label: 'Vehicle displacement (cc) — required for HS 8703 lines',
        helpRef: 'knowledge:tw.mof.commodity-tax-rates-2025#vehicles',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const c = this.categoryFor(ctx);
    if (!c) return {};
    const component: TariffFormulaComponent = {
      componentType: 'post_tax',
      formula: `value * ${c.rate}`,
      rateText: `${(c.rate * 100).toFixed(0)}% (${c.label})`,
      description: `Commodity Tax (貨物稅) — ${c.label}.`,
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: `TW_COMMODITY_${c.key}`,
      programFamily: 'tax',
      programAuthority: '貨物稅條例 (Commodity Tax Act)',
      legalReference: 'TW MOF Commodity Tax Act',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'TW MOF Commodity Tax rates',
        rowIdentifier: c.key,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component], notes: [`category=${c.key}`] };
  }

  private categoryFor(
    ctx: ExceptionRuleContext,
  ): { key: string; label: string; rate: number } | null {
    const code = normalizeHts(ctx.htsCode);
    const p4 = code.slice(0, 4);
    if (p4 === '8703') {
      // A1 fix (2026-05-26): reject booleans (Number(true)===1) and
      // accept comma-formatted strings consistently.
      const parsed = parseNumericInput(
        ctx.additionalInputs['tw_vehicle_displacement_cc'],
        { min: 0 },
      );
      const cc = parsed.ok ? parsed.value : Number.NaN;
      const isElectric = code.startsWith('870380');
      if (isElectric) return { key: 'VEHICLE_EV', label: 'EV/PHEV/hybrid', rate: 0.15 };
      if (Number.isFinite(cc) && cc > 2000) {
        return { key: 'VEHICLE_LARGE', label: 'vehicle >2000cc', rate: 0.30 };
      }
      return { key: 'VEHICLE_SMALL', label: 'vehicle ≤2000cc', rate: 0.25 };
    }
    if (p4 === '8418') return { key: 'REFRIGERATOR', label: 'refrigerator', rate: 0.13 };
    if (p4 === '8415') return { key: 'AIR_CONDITIONER', label: 'air conditioner', rate: 0.20 };
    if (p4 === '2523') return { key: 'CEMENT', label: 'cement', rate: 0.10 };
    if (p4 === '2202') return { key: 'BEVERAGE', label: 'sugared beverage', rate: 0.08 };
    if (p4 === '4011') return { key: 'TIRE', label: 'rubber tire', rate: 0.10 };
    if (p4 === '7003') return { key: 'GLASS', label: 'flat glass', rate: 0.10 };
    return null;
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
