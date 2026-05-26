import { Injectable, Logger } from '@nestjs/common';
import {
  FormulaVariable,
  SourceCitationRef,
  TariffApplyCondition,
  TariffFormulaComponent,
} from '../../../../calculator/services/tariff-types';

/**
 * KrTariffLookupService
 *
 * Korea Customs Service (KCS) publishes the Customs Tariff via the
 * UNI-PASS portal — Korean-language, no public English JSON API. Until a
 * manual ingestion lands, this lookup returns:
 *   1. The MFN ad-valorem rate when the HS6 prefix is in the seeded table.
 *   2. Otherwise a `base` placeholder with formula = '0' and a warning so
 *      the operator knows the rate must be verified manually.
 *
 * KORUS / KAFTA / KNZFTA / KSFTA / RCEP / ASEAN-Korea preferential rates
 * are handled by `preferentialOverride()` when a valid certificate is
 * presented and the origin matches the agreement's coverage.
 *
 * Source: https://unipass.customs.go.kr/clip/index.do
 */
@Injectable()
export class KrTariffLookupService {
  private readonly logger = new Logger(KrTariffLookupService.name);

  /**
   * Most-traveled HS6 → MFN rate seed. Korean MFN rates are mostly 0% or
   * 8% for consumer goods; agricultural goods carry much higher rates.
   * Replace with a real KCS-ingested table.
   */
  private readonly MFN_BY_HS6: Record<string, number> = {
    // Apparel — 13% generally
    '610910': 0.13, // T-shirts of cotton
    '620342': 0.13, // Men's trousers of cotton
    // Footwear
    '640399': 0.13,
    // Electronics — most free in Korea
    '851712': 0, // Mobile phones
    '852872': 0, // TVs
    '847130': 0, // Laptop computers
    // Cosmetics — 8%
    '330499': 0.08,
    // Bags / wallets — 8%
    '420232': 0.08,
    // Toys — 8%
    '950300': 0.08,
  };

  private readonly citation: SourceCitationRef = {
    source: 'Korea Customs Service (UNI-PASS)',
    url: 'https://unipass.customs.go.kr/clip/index.do',
    confidence: 0.7,
    parserMethod: 'kr_seed_table',
  };

  lookupMfn(hsCode: string): TariffFormulaComponent {
    const digits = (hsCode || '').replace(/\D/g, '');
    const hs6 = digits.slice(0, 6);
    const rate = this.MFN_BY_HS6[hs6];
    const always: TariffApplyCondition = { kind: 'always' };
    const vars: FormulaVariable[] = [
      {
        name: 'value',
        type: 'number',
        description: 'Declared value (KRW or invoice currency converted to KRW)',
      },
    ];

    if (rate === undefined) {
      this.logger.debug(`KR MFN rate unknown for HS6=${hs6}; defaulting to 0 + warning`);
      return {
        componentType: 'base',
        formula: '0',
        rateText: 'KR MFN rate not seeded — operator review required',
        identifier: `KR_MFN_${hs6}_UNKNOWN`,
        description: 'Korea MFN rate (no data — defaulted to zero)',
        requiredVariables: vars,
        appliesWhen: always,
        confidence: 0.3,
        sourceCitation: { ...this.citation, rowIdentifier: hs6 },
      };
    }

    return {
      componentType: 'base',
      formula: `value * ${rate}`,
      rateText: `${(rate * 100).toFixed(2)}% MFN`,
      identifier: `KR_MFN_${hs6}`,
      description: 'Korea MFN (Most-Favoured-Nation) duty',
      requiredVariables: vars,
      appliesWhen: always,
      confidence: 0.85,
      sourceCitation: { ...this.citation, rowIdentifier: hs6 },
    };
  }

  /**
   * KORUS / KAFTA / KNZFTA / KSFTA / RCEP / AKFTA preferential overrides.
   * Most consumer goods drop to 0% under these agreements; specifics vary
   * by HS and by Korea's staging schedule (not modelled here).
   */
  preferentialOverride(args: {
    hsCode: string;
    originCountry: string;
    certificate?: { agreement: string; claimed: boolean };
  }): TariffFormulaComponent | null {
    if (!args.certificate?.claimed) return null;
    const agreement = args.certificate.agreement.toUpperCase();
    const origin = (args.originCountry || '').toUpperCase();

    const KORUS_PARTNERS = new Set(['US']);
    const KAFTA_PARTNERS = new Set(['AU']);
    const KNZFTA_PARTNERS = new Set(['NZ']);
    const KSFTA_PARTNERS = new Set(['SG']);
    const RCEP_PARTNERS = new Set([
      'AU', 'NZ', 'SG', 'CN', 'JP', 'BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'TH', 'VN',
    ]);
    const AKFTA_PARTNERS = new Set(['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN']);

    if (agreement === 'KORUS' && KORUS_PARTNERS.has(origin)) {
      return this.makePreference(args.hsCode, 'KORUS');
    }
    if (agreement === 'KAFTA' && KAFTA_PARTNERS.has(origin)) {
      return this.makePreference(args.hsCode, 'KAFTA');
    }
    if (agreement === 'KNZFTA' && KNZFTA_PARTNERS.has(origin)) {
      return this.makePreference(args.hsCode, 'KNZFTA');
    }
    if (agreement === 'KSFTA' && KSFTA_PARTNERS.has(origin)) {
      return this.makePreference(args.hsCode, 'KSFTA');
    }
    if (agreement === 'RCEP' && RCEP_PARTNERS.has(origin)) {
      return this.makePreference(args.hsCode, 'RCEP');
    }
    if (agreement === 'AKFTA' && AKFTA_PARTNERS.has(origin)) {
      return this.makePreference(args.hsCode, 'AKFTA');
    }
    return null;
  }

  private makePreference(hsCode: string, agreement: string): TariffFormulaComponent {
    return {
      componentType: 'special',
      formula: '0',
      rateText: `${agreement} preferential (Free)`,
      identifier: `KR_${agreement}`,
      description: `Korea ${agreement} preferential rate`,
      requiredVariables: [],
      appliesWhen: { kind: 'requires_certificate', agreement },
      confidence: 0.8,
      sourceCitation: {
        ...this.citation,
        rowIdentifier: `${hsCode.replace(/\D/g, '').slice(0, 6)}|${agreement}`,
      },
    };
  }
}
