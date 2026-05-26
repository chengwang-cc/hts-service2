import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';

/**
 * Rule: au.luxury-car-tax
 * Authority: A New Tax System (Luxury Car Tax) Act 1999
 * Scope: Passenger vehicles (HS 87.03) imported into Australia where the
 *        customs value exceeds the financial-year threshold.
 *
 * Sources:
 *   - ato.lct-thresholds (ATO published table)
 *   - ato.gst-act-section-1-200 (LCT Act 1999 §1-200)
 *
 * Plain-English summary:
 *   LCT = 33% × (customs value − threshold). Two thresholds per FY:
 *   one for fuel-efficient vehicles (≤7L/100km), one for all others.
 *   Both are indexed annually.
 *
 *   Inputs:
 *     - `au_lct_eligible`: boolean — true if the vehicle is in the
 *       luxury-car scope (defaults to true when scope HTS matches).
 *     - `au_vehicle_fuel_efficient`: boolean — selects threshold.
 *
 *   The rule precomputes the threshold inside `evaluate()` and emits a
 *   formula literal `(value - <threshold>) * 0.33` with a
 *   `constraints.minAmount: 0` so negative results clamp to zero.
 *
 * Conflicts / stacking:
 *   - None. Stacks with GST (computed on VoTI by the AU adapter).
 *
 * Last reviewed by counsel: PENDING (P5.T12)
 */
interface LctData {
  rate: number;
  byFinancialYear: Array<{
    effectiveFrom: string;
    effectiveTo: string;
    thresholdStandard: number;
    thresholdFuelEfficient: number;
  }>;
  scope: Array<{ htsCode: string; category: string }>;
}

@Injectable()
export class AuLuxuryCarTaxRule implements ExceptionRule {
  private readonly logger = new Logger(AuLuxuryCarTaxRule.name);
  readonly id = 'au.luxury-car-tax';
  readonly destination = 'AU';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'AU Luxury Car Tax (LCT)';
  readonly priority = 9000;
  readonly knowledgeCardKeys = ['ato.lct-thresholds', 'ato.gst-act-section-1-200'];

  private readonly data: LctData;
  private readonly scopePrefixes: Set<string>;

  constructor() {
    const dataPath = path.join(__dirname, 'data', 'lct-thresholds.json');
    this.data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as LctData;
    this.scopePrefixes = new Set(
      this.data.scope.map((s) => normalizeHts(s.htsCode).slice(0, 6)),
    );
    this.logger.log(
      `AU LCT loaded: ${this.data.byFinancialYear.length} FYs, ${this.scopePrefixes.size} scope prefixes`,
    );
  }

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'AU') return false;
    const p6 = normalizeHts(ctx.htsCode).slice(0, 6);
    if (!this.scopePrefixes.has(p6)) return false;
    // Operators may opt out via the explicit eligibility flag.
    if (ctx.additionalInputs['au_lct_eligible'] === false) return false;
    return true;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'au_lct_eligible',
        type: 'boolean',
        required: false,
        label: 'LCT-eligible vehicle? (defaults to true for HS 87.03)',
        helpRef: 'knowledge:ato.lct-thresholds',
      },
      {
        name: 'au_vehicle_fuel_efficient',
        type: 'boolean',
        required: false,
        label: 'Fuel-efficient vehicle (≤7L/100km)? Higher threshold applies.',
        helpRef: 'knowledge:ato.gst-act-section-1-200',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const fy = this.findFy(ctx.asOfDate);
    if (!fy) return { notes: ['no FY threshold for asOfDate'] };
    const fuelEfficient = Boolean(ctx.additionalInputs['au_vehicle_fuel_efficient']);
    const threshold = fuelEfficient ? fy.thresholdFuelEfficient : fy.thresholdStandard;
    const component: TariffFormulaComponent = {
      componentType: 'post_tax',
      formula: `(value - ${threshold}) * ${this.data.rate}`,
      rateText: `LCT 33% above AUD ${threshold.toLocaleString()}`,
      description: `Luxury Car Tax — ${fuelEfficient ? 'fuel-efficient' : 'standard'} threshold for ${ctx.asOfDate.getFullYear()}.`,
      requiredVariables: [
        { name: 'value', type: 'number', dimension: 'money' },
      ],
      identifier: `AU_LCT_${threshold}`,
      programFamily: 'tax',
      programAuthority: 'A New Tax System (Luxury Car Tax) Act 1999',
      legalReference: 'LCT Act 1999 §1-200',
      appliesWhen: { kind: 'always' },
      constraints: { minAmount: 0 },
      sourceCitation: {
        source: 'ATO LCT thresholds',
        rowIdentifier: `threshold-${threshold}`,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component], notes: [`fy=${fy.effectiveFrom.slice(0, 4)} threshold=${threshold}`] };
  }

  private findFy(asOf: Date): LctData['byFinancialYear'][number] | null {
    for (const fy of this.data.byFinancialYear) {
      if (asOf >= new Date(fy.effectiveFrom) && asOf < new Date(fy.effectiveTo)) return fy;
    }
    return null;
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
