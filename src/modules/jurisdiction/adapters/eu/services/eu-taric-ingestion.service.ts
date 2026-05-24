import { Injectable, Logger } from '@nestjs/common';
import {
  FormulaVariable,
  SourceCitationRef,
  TariffApplyCondition,
  TariffFormulaComponent,
} from '../../../../calculator/services/tariff-types';

/**
 * EuTaricIngestionService
 *
 * The official TARIC data is published by the European Commission for
 * Member-State customs administrations but isn't exposed as a clean
 * public JSON API. Bulk download is via DDS2 and licensing terms apply.
 *
 * For now this service:
 *   • Knows a small seeded MFN/CCT table (similar to CA) so the adapter
 *     is exercisable end-to-end.
 *   • Emits an unparsed-row warning when an HS6 isn't seeded.
 *   • Returns the same shape Gb / Ca return so the LandedCostService
 *     pipeline doesn't need EU-specific handling.
 *
 * The full DDS2 / Commission Excel ingestion is a P6 follow-up.
 */
@Injectable()
export class EuTaricIngestionService {
  private readonly logger = new Logger(EuTaricIngestionService.name);

  private readonly MFN_BY_HS6: Record<string, number> = {
    '610910': 0.12, // Cotton T-shirts
    '620342': 0.12, // Men's cotton trousers
    '640399': 0.08, // Footwear
    '851712': 0, // Mobile phones — free
    '852872': 0.14, // TVs
    '950300': 0.047, // Children's toys
    '420232': 0.03, // Wallets / handbags
    '220421': 0, // Wine — specific duty per litre; placeholder 0
  };

  private readonly citation: SourceCitationRef = {
    source: 'EU TARIC',
    url: 'https://taxation-customs.ec.europa.eu/customs-4/calculation-customs-duties/customs-tariff/eu-customs-tariff-taric_en',
    confidence: 0.7,
    parserMethod: 'eu_seed_table',
  };

  async fetchComponents(hsCode: string, originCountry: string): Promise<{
    components: TariffFormulaComponent[];
    warnings: string[];
  }> {
    const digits = (hsCode || '').replace(/\D/g, '');
    const hs6 = digits.slice(0, 6);
    const rate = this.MFN_BY_HS6[hs6];
    const always: TariffApplyCondition = { kind: 'always' };
    const vars: FormulaVariable[] = [
      { name: 'value', type: 'number', description: 'Declared value (EUR)' },
    ];

    if (rate === undefined) {
      return {
        components: [
          {
            componentType: 'base',
            formula: '0',
            rateText: 'TARIC rate not seeded — operator review required',
            identifier: `EU_TARIC_${hs6}_UNKNOWN`,
            description: 'EU TARIC rate (no data — defaulted to zero)',
            requiredVariables: vars,
            appliesWhen: always,
            confidence: 0.3,
            sourceCitation: { ...this.citation, rowIdentifier: hs6 },
          },
        ],
        warnings: [`EU_TARIC_HS6_NOT_SEEDED:${hs6}`],
      };
    }

    return {
      components: [
        {
          componentType: 'base',
          formula: `value * ${rate}`,
          rateText: `${(rate * 100).toFixed(2)}% CCT`,
          identifier: `EU_CCT_${hs6}`,
          description: 'EU Common Customs Tariff',
          requiredVariables: vars,
          appliesWhen: always,
          confidence: 0.9,
          sourceCitation: { ...this.citation, rowIdentifier: hs6 },
        },
      ],
      warnings: [],
    };
  }
}
