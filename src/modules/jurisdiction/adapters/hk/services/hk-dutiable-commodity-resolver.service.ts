import { Injectable } from '@nestjs/common';
import {
  FormulaVariable,
  SourceCitationRef,
  TariffApplyCondition,
  TariffFormulaComponent,
} from '../../../../calculator/services/tariff-types';

/**
 * HkDutiableCommodityResolverService (P5.2)
 *
 * Hong Kong is a free port — there is no general customs tariff. Excise
 * duties only apply to "dutiable commodities" published by GovHK:
 *   - liquor (Chapter 22, with alcohol >= 30% strength)
 *   - tobacco (Chapter 24)
 *   - hydrocarbon oil (specific subheadings under 27.10)
 *   - methyl alcohol (specific 22.07 subheading)
 *
 * Source: https://www.gov.hk/en/residents/taxes/commodities/index.htm and
 * https://www.customs.gov.hk/en/service-enforcement-information/cargo-clearance/
 *
 * We do not encode the exact excise *rates* here because they are revised
 * by Hong Kong Inland Revenue / Customs and Excise periodically — the
 * resolver only flags whether the line is excisable and what variables
 * it needs (volume, strength, weight). Rates live in FeeRuleEntity rows
 * that admins maintain through the P4.3 admin CRUD.
 */
@Injectable()
export class HkDutiableCommodityResolverService {
  private readonly LIQUOR_HEADING_PREFIXES = ['2203', '2204', '2205', '2206', '2208'];
  private readonly TOBACCO_HEADING_PREFIXES = ['2401', '2402', '2403'];
  private readonly METHYL_ALCOHOL_HEADING_PREFIXES = ['220710', '220720'];
  private readonly HYDROCARBON_OIL_HEADING_PREFIXES = [
    '271012', // light oils — gasoline / aviation gasoline / jet fuel
    '271019', // medium / heavy oils — diesel / fuel oil
    '271020',
  ];

  /**
   * Determines whether the line is dutiable in HK and, if so, returns the
   * variable requirements + a `chapter_98`-style placeholder component
   * that admins (via FeeRuleEntity rows or manual override) flesh out
   * with an actual rate.
   */
  classify(hsCode: string): {
    dutiable: boolean;
    category: 'liquor' | 'tobacco' | 'methyl_alcohol' | 'hydrocarbon_oil' | null;
    requiredVariables: FormulaVariable[];
    note: string;
  } {
    const digits = (hsCode || '').replace(/\D/g, '');
    if (!digits) {
      return { dutiable: false, category: null, requiredVariables: [], note: '' };
    }

    if (this.METHYL_ALCOHOL_HEADING_PREFIXES.some((p) => digits.startsWith(p))) {
      return {
        dutiable: true,
        category: 'methyl_alcohol',
        requiredVariables: this.varsFor(['volume_liters']),
        note: 'Methyl alcohol attracts HK excise duty (Customs and Excise Ordinance).',
      };
    }

    if (this.HYDROCARBON_OIL_HEADING_PREFIXES.some((p) => digits.startsWith(p))) {
      return {
        dutiable: true,
        category: 'hydrocarbon_oil',
        requiredVariables: this.varsFor(['volume_liters']),
        note: 'Hydrocarbon oil attracts HK excise duty.',
      };
    }

    if (this.LIQUOR_HEADING_PREFIXES.some((p) => digits.startsWith(p))) {
      return {
        dutiable: true,
        category: 'liquor',
        requiredVariables: this.varsFor(['volume_liters', 'alcohol_strength']),
        note:
          'Liquor with alcohol strength >= 30% attracts HK excise duty; >= 100% in some categories.',
      };
    }

    if (this.TOBACCO_HEADING_PREFIXES.some((p) => digits.startsWith(p))) {
      return {
        dutiable: true,
        category: 'tobacco',
        requiredVariables: this.varsFor(['quantity', 'weight']),
        note: 'Tobacco products attract HK excise duty.',
      };
    }

    return { dutiable: false, category: null, requiredVariables: [], note: '' };
  }

  /**
   * Build TariffFormulaComponent rows for the resolver. Returns the
   * "free port — no general duty" component for ordinary goods, or a
   * placeholder excise component (amount = 0) annotated with the
   * dutiable-commodity note that admins must fulfil via FeeRuleEntity.
   */
  buildComponents(hsCode: string): TariffFormulaComponent[] {
    const citation: SourceCitationRef = {
      source: 'HK Customs and Excise',
      url: 'https://www.customs.gov.hk/en/service-enforcement-information/cargo-clearance/',
      rowIdentifier: hsCode,
      confidence: 1.0,
      parserMethod: 'hk_free_port',
    };

    const always: TariffApplyCondition = { kind: 'always' };
    const classified = this.classify(hsCode);

    if (!classified.dutiable) {
      return [
        {
          componentType: 'base',
          formula: '0',
          rateText: 'Free (Hong Kong is a free port)',
          identifier: hsCode,
          description: 'Hong Kong free-port — no general customs duty',
          requiredVariables: [],
          appliesWhen: always,
          confidence: 1.0,
          sourceCitation: citation,
        },
      ];
    }

    // For dutiable categories we emit two components:
    //  1. The free-port base zero-duty component.
    //  2. A placeholder excise component which carries the required
    //     variable set and zero formula — the real rate is expected to
    //     be defined in FeeRuleEntity (managed via /admin/jurisdictions/HK/rules).
    return [
      {
        componentType: 'base',
        formula: '0',
        rateText: 'Free (HK free port)',
        identifier: hsCode,
        description: 'Hong Kong free-port — no general customs duty',
        requiredVariables: [],
        appliesWhen: always,
        confidence: 1.0,
        sourceCitation: citation,
      },
      {
        componentType: 'post_tax',
        formula: '0',
        rateText: classified.note,
        identifier: `HK_EXCISE_${classified.category!.toUpperCase()}`,
        description: `HK excise placeholder (${classified.category}) — rate maintained in FeeRuleEntity`,
        requiredVariables: classified.requiredVariables,
        appliesWhen: always,
        confidence: 0.8,
        sourceCitation: {
          ...citation,
          parserMethod: 'hk_excise_placeholder',
        },
      },
    ];
  }

  private varsFor(names: string[]): FormulaVariable[] {
    return names.map((name) => ({
      name,
      type: 'number',
      description: {
        volume_liters: 'Volume of imported product in liters',
        alcohol_strength: 'Alcohol strength as percentage (0..100)',
        quantity: 'Quantity of units',
        weight: 'Weight in kg',
      }[name] || `Additional input: ${name}`,
    }));
  }
}
