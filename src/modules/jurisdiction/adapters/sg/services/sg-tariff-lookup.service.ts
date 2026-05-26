import { Injectable, Logger } from '@nestjs/common';
import {
  FormulaVariable,
  SourceCitationRef,
  TariffApplyCondition,
  TariffFormulaComponent,
} from '../../../../calculator/services/tariff-types';

/**
 * SgTariffLookupService
 *
 * Singapore is a free port — customs/excise duty applies only to four
 * categories:
 *   1. Intoxicating liquors
 *   2. Tobacco products
 *   3. Motor vehicles
 *   4. Petroleum products & biodiesel blends
 *
 * Everything else is duty-free under Singapore tariff (GST still applies
 * — see SgGstResolverService). The seed table flags those four families
 * by HS chapter prefix and emits an `excise` placeholder component; for
 * everything else this lookup returns a `base` component with formula = '0'
 * and a clear "free port" message.
 *
 * Source: https://www.customs.gov.sg/businesses/harmonised-system-hs-classification-of-goods
 */
@Injectable()
export class SgTariffLookupService {
  private readonly logger = new Logger(SgTariffLookupService.name);

  /** HS chapter prefixes for dutiable categories (chapter 22 = beverages, 24 = tobacco, 27 = oil/gas, 87 = motor vehicles). */
  private readonly DUTIABLE_PREFIXES: ReadonlyArray<{
    chapterRange: [number, number];
    category: 'liquor' | 'tobacco' | 'motor_vehicle' | 'petroleum';
    rate: number;
    rateText: string;
    description: string;
  }> = [
    {
      chapterRange: [22, 22],
      category: 'liquor',
      rate: 0.0,
      rateText: 'Specific rate per litre alcohol — admin-managed (placeholder 0)',
      description: 'Singapore excise duty on intoxicating liquors',
    },
    {
      chapterRange: [24, 24],
      category: 'tobacco',
      rate: 0.0,
      rateText: 'Specific rate per stick / kg — admin-managed (placeholder 0)',
      description: 'Singapore excise duty on tobacco products',
    },
    {
      chapterRange: [27, 27],
      category: 'petroleum',
      rate: 0.0,
      rateText: 'Specific rate per litre — admin-managed (placeholder 0)',
      description: 'Singapore excise duty on petroleum / biodiesel',
    },
    {
      chapterRange: [87, 87],
      category: 'motor_vehicle',
      rate: 0.2,
      rateText: '20% customs duty (motor vehicles)',
      description: 'Singapore customs duty on motor vehicles',
    },
  ];

  private readonly citation: SourceCitationRef = {
    source: 'Singapore Customs',
    url: 'https://www.customs.gov.sg/businesses/harmonised-system-hs-classification-of-goods',
    confidence: 0.7,
    parserMethod: 'sg_seed_table',
  };

  lookupBase(hsCode: string): TariffFormulaComponent {
    const digits = (hsCode || '').replace(/\D/g, '');
    const hs6 = digits.slice(0, 6);
    const chapter = parseInt(hs6.slice(0, 2), 10);
    const always: TariffApplyCondition = { kind: 'always' };
    const vars: FormulaVariable[] = [
      { name: 'value', type: 'number', description: 'Declared value (SGD)' },
    ];

    const dutiable = this.DUTIABLE_PREFIXES.find(
      (d) => chapter >= d.chapterRange[0] && chapter <= d.chapterRange[1],
    );

    if (dutiable && dutiable.rate > 0) {
      // Ad-valorem case (motor vehicles).
      return {
        componentType: 'base',
        formula: `value * ${dutiable.rate}`,
        rateText: dutiable.rateText,
        identifier: `SG_${dutiable.category.toUpperCase()}_${hs6}`,
        description: dutiable.description,
        requiredVariables: vars,
        appliesWhen: always,
        confidence: 0.8,
        sourceCitation: { ...this.citation, rowIdentifier: hs6 },
      };
    }

    if (dutiable) {
      // Specific-rate excise: amount is admin-managed; emit a placeholder
      // with formula = '0' and a description that names the category so
      // the UI explains why the row exists.
      return {
        componentType: 'base',
        formula: '0',
        rateText: dutiable.rateText,
        identifier: `SG_EXCISE_${dutiable.category.toUpperCase()}_${hs6}`,
        description: dutiable.description,
        requiredVariables: vars,
        appliesWhen: always,
        confidence: 0.6,
        sourceCitation: { ...this.citation, rowIdentifier: hs6 },
      };
    }

    // Default: free port — duty-free.
    return {
      componentType: 'base',
      formula: '0',
      rateText: 'Free (Singapore is a free port)',
      identifier: `SG_FREE_${hs6}`,
      description: 'Duty-free — Singapore applies customs duty only to liquor, tobacco, motor vehicles, and petroleum',
      requiredVariables: vars,
      appliesWhen: always,
      confidence: 0.95,
      sourceCitation: { ...this.citation, rowIdentifier: hs6 },
    };
  }

  /** Is the HS code in one of the four dutiable Singapore categories? */
  isDutiable(hsCode: string): boolean {
    const digits = (hsCode || '').replace(/\D/g, '');
    const chapter = parseInt(digits.slice(0, 2), 10);
    return this.DUTIABLE_PREFIXES.some(
      (d) => chapter >= d.chapterRange[0] && chapter <= d.chapterRange[1],
    );
  }
}
