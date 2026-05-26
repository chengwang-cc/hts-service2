import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';

/**
 * Rule: tw.tobacco-alcohol-tax
 * Authority: 菸酒稅法 (Tobacco and Alcohol Tax Act)
 * Scope: HS 22.03–22.08 (beer, wine, spirits) and HS 24.02–24.03
 *        (cigarettes, cigars, other tobacco products).
 *
 * Sources:
 *   - tw.mof.tobacco-alcohol-tax-act
 *   - tw.mof.health-welfare-surcharge
 *
 * Plain-English summary:
 *   Specific rates per liter or per kg of product. Tobacco products
 *   additionally carry a Health & Welfare surcharge of NTD 1000/kg.
 *   Representative 2025 rates:
 *     - Beer: NTD 26 / L
 *     - Wine: NTD 7 / L per degree of alcohol
 *     - Spirits: NTD 2.5 / L per degree
 *     - Cigarettes: NTD 1590 / 1000 sticks
 *     - Other tobacco: NTD 1590 / kg
 *
 *   Inputs:
 *     - `tw_alcohol_liters`: number — for beverages
 *     - `tw_alcohol_degree`: number — for wine/spirits
 *     - `tw_tobacco_sticks`: number — for cigarettes
 *
 * Conflicts / stacking:
 *   - Stacks with VAT.
 *
 * Last reviewed by counsel: PENDING (P5.T12)
 */
@Injectable()
export class TwTobaccoAlcoholTaxRule implements ExceptionRule {
  readonly id = 'tw.tobacco-alcohol-tax';
  readonly destination = 'TW';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'TW Tobacco & Alcohol Tax (菸酒稅 + 健康捐)';
  readonly priority = 9010;
  readonly knowledgeCardKeys = [
    'tw.mof.tobacco-alcohol-tax-act',
    'tw.mof.health-welfare-surcharge',
  ];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'TW') return false;
    return this.categoryFor(ctx.htsCode) !== null;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'tw_alcohol_liters',
        type: 'number',
        required: false,
        label: 'Alcohol — total litres',
      },
      {
        name: 'tw_alcohol_degree',
        type: 'number',
        required: false,
        label: 'Alcohol — degree (for wine / spirits)',
      },
      {
        name: 'tw_tobacco_sticks',
        type: 'int',
        required: false,
        label: 'Tobacco — number of sticks (cigarettes)',
      },
      {
        name: 'tw_tobacco_kg',
        type: 'number',
        required: false,
        label: 'Tobacco — kg (cigars / other)',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const cat = this.categoryFor(ctx.htsCode);
    if (!cat) return {};
    const a = ctx.additionalInputs;
    let amount = 0;
    let healthSurcharge = 0;
    let detail = '';
    if (cat === 'beer') {
      const l = Number(a['tw_alcohol_liters'] ?? 0);
      amount = l * 26;
      detail = `${l}L × NTD 26`;
    } else if (cat === 'wine') {
      const l = Number(a['tw_alcohol_liters'] ?? 0);
      const deg = Number(a['tw_alcohol_degree'] ?? 0);
      amount = l * deg * 7;
      detail = `${l}L × ${deg}° × NTD 7`;
    } else if (cat === 'spirits') {
      const l = Number(a['tw_alcohol_liters'] ?? 0);
      const deg = Number(a['tw_alcohol_degree'] ?? 0);
      amount = l * deg * 2.5;
      detail = `${l}L × ${deg}° × NTD 2.5`;
    } else if (cat === 'cigarettes') {
      const sticks = Number(a['tw_tobacco_sticks'] ?? 0);
      amount = (sticks / 1000) * 1590;
      const kg = sticks * 0.001;
      healthSurcharge = kg * 1000;
      detail = `${sticks} sticks × NTD 1.59`;
    } else if (cat === 'other_tobacco') {
      const kg = Number(a['tw_tobacco_kg'] ?? 0);
      amount = kg * 1590;
      healthSurcharge = kg * 1000;
      detail = `${kg}kg × NTD 1590`;
    }

    const components: TariffFormulaComponent[] = [];
    components.push({
      componentType: 'post_tax',
      formula: `${amount}`,
      rateText: `${cat} excise`,
      description: `TW Tobacco/Alcohol Tax — ${cat}: ${detail}.`,
      requiredVariables: [],
      identifier: `TW_TAT_${cat.toUpperCase()}`,
      programFamily: 'tax',
      programAuthority: '菸酒稅法 (Tobacco and Alcohol Tax Act)',
      legalReference: 'TW MOF Tobacco & Alcohol Tax Act',
      appliesWhen: { kind: 'always' },
      sourceCitation: { source: 'TW MOF', rowIdentifier: cat, confidence: 1, parserMethod: 'manual' },
      confidence: 1,
    });
    if (healthSurcharge > 0) {
      components.push({
        componentType: 'post_tax',
        formula: `${healthSurcharge}`,
        rateText: 'Health & Welfare surcharge (NTD 1000/kg tobacco)',
        description: 'TW Health & Welfare surcharge on tobacco products.',
        requiredVariables: [],
        identifier: 'TW_HEALTH_WELFARE_TOBACCO',
        programFamily: 'tax',
        programAuthority: 'TW MOF Health & Welfare Surcharge',
        legalReference: 'Tobacco Hazards Prevention Act',
        appliesWhen: { kind: 'always' },
        sourceCitation: { source: 'TW MOF Health & Welfare', rowIdentifier: 'tobacco-surcharge', confidence: 1, parserMethod: 'manual' },
        confidence: 1,
      });
    }
    return { add: components, notes: [`category=${cat}`] };
  }

  private categoryFor(htsCode: string): 'beer' | 'wine' | 'spirits' | 'cigarettes' | 'other_tobacco' | null {
    const p4 = normalizeHts(htsCode).slice(0, 4);
    if (p4 === '2203') return 'beer';
    if (p4 === '2204' || p4 === '2205' || p4 === '2206') return 'wine';
    if (p4 === '2208') return 'spirits';
    if (p4 === '2402') return 'cigarettes';
    if (p4 === '2403') return 'other_tobacco';
    return null;
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
