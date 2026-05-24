import { Injectable, Logger } from '@nestjs/common';
import {
  FormulaVariable,
  SourceCitationRef,
  TariffApplyCondition,
  TariffFormulaComponent,
} from '../../../../calculator/services/tariff-types';

/**
 * CaTariffLookupService
 *
 * Canada's CBSA does not publish a clean public JSON API (unlike GOV.UK
 * Trade Tariff). The official source is the annual Customs Tariff PDF /
 * structured download from
 * https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/menu-eng.html.
 *
 * Until a CBSA ingestion job lands, this lookup:
 *   1. Returns the MFN ad-valorem rate when the HS code is in our seeded
 *      CSV mini-table (`ca_seed_rates.json`).
 *   2. Otherwise emits a `base` placeholder with formula = '0' and a
 *      warning telling the operator the CBSA rate must be sourced manually.
 *
 * CUSMA / CCFTA / CPTPP preferential rates are handled by the caller
 * (CaCustomsAdapter.calculate) when a valid certificate is presented.
 */
@Injectable()
export class CaTariffLookupService {
  private readonly logger = new Logger(CaTariffLookupService.name);

  /**
   * Hard-coded MFN rates for the most-traveled HS6 prefixes so the adapter
   * is exercisable today. The intent is for these to be replaced by a
   * CBSA-derived seed table the moment ingestion is built.
   */
  private readonly MFN_BY_HS6: Record<string, number> = {
    // Apparel
    '610910': 0.18, // T-shirts of cotton
    '620342': 0.18, // Men's trousers of cotton
    '640399': 0.18, // Footwear
    // Electronics
    '851712': 0, // Mobile phones — free
    '852872': 0, // TVs LCD/LED — free
    // Common gifts
    '950300': 0, // Children's toys
    '420232': 0.07, // Wallets / handbags
  };

  /**
   * Same source-citation across rows.
   */
  private readonly citation: SourceCitationRef = {
    source: 'CBSA Customs Tariff',
    url: 'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/menu-eng.html',
    confidence: 0.7,
    parserMethod: 'ca_seed_table',
  };

  lookupMfn(hsCode: string): TariffFormulaComponent {
    const digits = (hsCode || '').replace(/\D/g, '');
    const hs6 = digits.slice(0, 6);
    const rate = this.MFN_BY_HS6[hs6];
    const always: TariffApplyCondition = { kind: 'always' };
    const vars: FormulaVariable[] = [
      { name: 'value', type: 'number', description: 'Declared value (CAD)' },
    ];

    if (rate === undefined) {
      this.logger.debug(
        `CA MFN rate unknown for HS6=${hs6}; defaulting to 0 + warning`,
      );
      return {
        componentType: 'base',
        formula: '0',
        rateText: 'MFN rate not seeded — operator review required',
        identifier: `CA_MFN_${hs6}_UNKNOWN`,
        description: 'Canada MFN rate (no data — defaulted to zero)',
        requiredVariables: vars,
        appliesWhen: always,
        confidence: 0.3,
        sourceCitation: {
          ...this.citation,
          rowIdentifier: hs6,
        },
      };
    }

    return {
      componentType: 'base',
      formula: `value * ${rate}`,
      rateText: `${(rate * 100).toFixed(2)}% MFN`,
      identifier: `CA_MFN_${hs6}`,
      description: 'Canada MFN (Most-Favoured-Nation) duty',
      requiredVariables: vars,
      appliesWhen: always,
      confidence: 0.9,
      sourceCitation: { ...this.citation, rowIdentifier: hs6 },
    };
  }

  /**
   * CUSMA / CCFTA / CPTPP override: if the origin is a preference partner
   * AND a certificate is claimed, override MFN with 0 (most apparel /
   * consumer goods qualify; details vary by HS).
   */
  preferentialOverride(args: {
    hsCode: string;
    originCountry: string;
    certificate?: { agreement: string; claimed: boolean };
  }): TariffFormulaComponent | null {
    if (!args.certificate?.claimed) return null;
    const agreement = args.certificate.agreement.toUpperCase();
    const origin = (args.originCountry || '').toUpperCase();

    const CUSMA_PARTNERS = new Set(['US', 'MX']);
    const CPTPP_PARTNERS = new Set([
      'AU',
      'BN',
      'CL',
      'JP',
      'MY',
      'MX',
      'NZ',
      'PE',
      'SG',
      'VN',
      'GB',
    ]);

    if (agreement === 'CUSMA' && CUSMA_PARTNERS.has(origin)) {
      return this.makePreference(args.hsCode, 'CUSMA');
    }
    if (agreement === 'CPTPP' && CPTPP_PARTNERS.has(origin)) {
      return this.makePreference(args.hsCode, 'CPTPP');
    }
    if (agreement === 'CCFTA' && origin === 'CL') {
      return this.makePreference(args.hsCode, 'CCFTA');
    }
    return null;
  }

  private makePreference(
    hsCode: string,
    agreement: string,
  ): TariffFormulaComponent {
    return {
      componentType: 'special',
      formula: '0',
      rateText: `${agreement} preferential (Free)`,
      identifier: `CA_${agreement}`,
      description: `Canada ${agreement} preferential rate`,
      requiredVariables: [],
      appliesWhen: { kind: 'requires_certificate', agreement },
      confidence: 0.85,
      sourceCitation: {
        ...this.citation,
        rowIdentifier: `${hsCode.replace(/\D/g, '').slice(0, 6)}|${agreement}`,
      },
    };
  }
}
