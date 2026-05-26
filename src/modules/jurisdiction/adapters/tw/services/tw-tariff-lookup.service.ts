import { Injectable, Logger } from '@nestjs/common';
import {
  FormulaVariable,
  SourceCitationRef,
  TariffApplyCondition,
  TariffFormulaComponent,
} from '../../../../calculator/services/tariff-types';

/**
 * TwTariffLookupService
 *
 * Taiwan Customs Administration publishes the tariff schedule via CCC
 * (Commodity Classification Code of Republic of China) — 11 digits.
 * Taiwan publishes 3 columns:
 *   - Column 1: MFN (WTO members)
 *   - Column 2: General rate (higher)
 *   - Column 3: Special / preferential (for FTA partners)
 *
 * The portal at https://portal.sw.nat.gov.tw/PPL/HomePage requires
 * authenticated access and the data is Mandarin-only. Until manual
 * ingestion lands, this lookup uses a seeded HS6 mini-table with Column 1
 * MFN rates; unmapped codes default to 5% with a warning.
 *
 * Preferential rates engage via `preferentialOverride()` for ANZTEC (with
 * NZ) and ASTEP (with SG) — the two most active Taiwan FTAs.
 */
@Injectable()
export class TwTariffLookupService {
  private readonly logger = new Logger(TwTariffLookupService.name);

  /** HS6 → MFN rate (Column 1). Most consumer goods 5-10% in TW. */
  private readonly MFN_BY_HS6: Record<string, number> = {
    '610910': 0.105, // T-shirts of cotton — 10.5%
    '620342': 0.105, // Men's trousers
    '640399': 0.075, // Footwear — 7.5%
    '851712': 0, // Mobile phones — free
    '852872': 0, // TVs
    '847130': 0, // Laptops
    '330499': 0.05, // Cosmetics
    '420232': 0.05, // Bags / wallets
    '950300': 0, // Toys
    '870323': 0.175, // Motor vehicles — 17.5%
  };

  private readonly citation: SourceCitationRef = {
    source: 'Customs Administration of the Ministry of Finance, ROC',
    url: 'https://web.customs.gov.tw/EN',
    confidence: 0.6,
    parserMethod: 'tw_seed_table',
  };

  lookupMfn(hsCode: string): TariffFormulaComponent {
    const digits = (hsCode || '').replace(/\D/g, '');
    const hs6 = digits.slice(0, 6);
    const rate = this.MFN_BY_HS6[hs6];
    const always: TariffApplyCondition = { kind: 'always' };
    const vars: FormulaVariable[] = [
      { name: 'value', type: 'number', description: 'Declared value (TWD)' },
    ];

    if (rate === undefined) {
      this.logger.debug(`TW MFN rate unknown for HS6=${hs6}; defaulting to 5% + warning`);
      return {
        componentType: 'base',
        formula: 'value * 0.05',
        rateText: '5% MFN (default; seeded table miss — review required)',
        identifier: `TW_MFN_${hs6}_DEFAULT`,
        description: 'Taiwan MFN (Column 1) duty — defaulted to 5%',
        requiredVariables: vars,
        appliesWhen: always,
        confidence: 0.4,
        sourceCitation: { ...this.citation, rowIdentifier: hs6 },
      };
    }

    return {
      componentType: 'base',
      formula: `value * ${rate}`,
      rateText: `${(rate * 100).toFixed(2)}% MFN`,
      identifier: `TW_MFN_${hs6}`,
      description: 'Taiwan MFN (Column 1) duty',
      requiredVariables: vars,
      appliesWhen: always,
      confidence: 0.8,
      sourceCitation: { ...this.citation, rowIdentifier: hs6 },
    };
  }

  preferentialOverride(args: {
    hsCode: string;
    originCountry: string;
    certificate?: { agreement: string; claimed: boolean };
  }): TariffFormulaComponent | null {
    if (!args.certificate?.claimed) return null;
    const agreement = args.certificate.agreement.toUpperCase();
    const origin = (args.originCountry || '').toUpperCase();

    const ANZTEC = new Set(['NZ']);
    const ASTEP = new Set(['SG']);

    if (agreement === 'ANZTEC' && ANZTEC.has(origin)) return this.makePreference(args.hsCode, 'ANZTEC');
    if (agreement === 'ASTEP' && ASTEP.has(origin)) return this.makePreference(args.hsCode, 'ASTEP');
    return null;
  }

  private makePreference(hsCode: string, agreement: string): TariffFormulaComponent {
    return {
      componentType: 'special',
      formula: '0',
      rateText: `${agreement} preferential (Free)`,
      identifier: `TW_${agreement}`,
      description: `Taiwan ${agreement} preferential rate`,
      requiredVariables: [],
      appliesWhen: { kind: 'requires_certificate', agreement },
      confidence: 0.75,
      sourceCitation: {
        ...this.citation,
        rowIdentifier: `${hsCode.replace(/\D/g, '').slice(0, 6)}|${agreement}`,
      },
    };
  }
}
