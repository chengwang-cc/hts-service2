import { Injectable, Logger } from '@nestjs/common';
import {
  FormulaVariable,
  SourceCitationRef,
  TariffApplyCondition,
  TariffFormulaComponent,
} from '../../../../calculator/services/tariff-types';

/**
 * AuTariffLookupService
 *
 * Australian Border Force (ABF) maintains the Working Tariff (Schedule 3
 * to the Customs Tariff Act 1995). Most goods are 0% or 5% MFN. Until a
 * scheduled ingestion job ships, this lookup uses a seeded HS6 mini-table;
 * unmapped codes default to 5% with a warning (the conservative MFN).
 *
 * Preferential rates engage via `preferentialOverride()` for: AUSFTA, CER
 * (with NZ), AANZFTA (with ASEAN/NZ), SAFTA (with SG), KAFTA (with KR),
 * JAEPA (with JP), CHAFTA (with CN), CPTPP, RCEP, IA-CEPA (with ID),
 * A-UKFTA (with GB).
 *
 * Source: https://www.abf.gov.au/importing-exporting-and-manufacturing/tariff-classification
 */
@Injectable()
export class AuTariffLookupService {
  private readonly logger = new Logger(AuTariffLookupService.name);

  /** HS6 → MFN rate. Defaults to 0.05 (5%) when unmapped — Australia's
   * typical general rate. Free items (HS 85, 84 electronics etc.) seeded
   * explicitly. */
  private readonly MFN_BY_HS6: Record<string, number> = {
    // Apparel — 5%
    '610910': 0.05, // T-shirts
    '620342': 0.05, // Men's trousers
    '640399': 0.05, // Footwear
    // Electronics — most free
    '851712': 0,
    '852872': 0,
    '847130': 0,
    // Cosmetics / personal care — 5%
    '330499': 0.05,
    // Bags / wallets — 5%
    '420232': 0.05,
    // Toys — free
    '950300': 0,
    // Wine / alcohol — handled via excise (placeholder 0; excise is per-litre)
    '220421': 0,
    // Motor vehicles — 5% + Luxury Car Tax above threshold (LCT not modelled here)
    '870323': 0.05,
  };

  private readonly citation: SourceCitationRef = {
    source: 'Australian Border Force — Customs Tariff Working Pages',
    url: 'https://www.abf.gov.au/importing-exporting-and-manufacturing/tariff-classification',
    confidence: 0.7,
    parserMethod: 'au_seed_table',
  };

  lookupMfn(hsCode: string): TariffFormulaComponent {
    const digits = (hsCode || '').replace(/\D/g, '');
    const hs6 = digits.slice(0, 6);
    const rate = this.MFN_BY_HS6[hs6];
    const always: TariffApplyCondition = { kind: 'always' };
    const vars: FormulaVariable[] = [
      { name: 'value', type: 'number', description: 'Declared value (AUD)' },
    ];

    if (rate === undefined) {
      this.logger.debug(`AU MFN rate unknown for HS6=${hs6}; defaulting to 5% (general rate) + warning`);
      return {
        componentType: 'base',
        formula: 'value * 0.05',
        rateText: '5% MFN (default; seeded table miss — review required)',
        identifier: `AU_MFN_${hs6}_DEFAULT`,
        description: 'Australia MFN duty (defaulted to 5%)',
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
      identifier: `AU_MFN_${hs6}`,
      description: 'Australia MFN duty',
      requiredVariables: vars,
      appliesWhen: always,
      confidence: 0.85,
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

    const AUSFTA = new Set(['US']);
    const CER = new Set(['NZ']);
    const AANZFTA = new Set(['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'NZ', 'PH', 'SG', 'TH', 'VN']);
    const SAFTA = new Set(['SG']);
    const KAFTA = new Set(['KR']);
    const JAEPA = new Set(['JP']);
    const CHAFTA = new Set(['CN']);
    const CPTPP = new Set(['BN', 'CA', 'CL', 'JP', 'MY', 'MX', 'NZ', 'PE', 'SG', 'VN', 'GB']);
    const RCEP = new Set(['BN', 'KH', 'CN', 'ID', 'JP', 'KR', 'LA', 'MY', 'MM', 'NZ', 'PH', 'SG', 'TH', 'VN']);
    const IA_CEPA = new Set(['ID']);
    const A_UKFTA = new Set(['GB']);

    if (agreement === 'AUSFTA' && AUSFTA.has(origin)) return this.makePreference(args.hsCode, 'AUSFTA');
    if (agreement === 'CER' && CER.has(origin)) return this.makePreference(args.hsCode, 'CER');
    if (agreement === 'AANZFTA' && AANZFTA.has(origin)) return this.makePreference(args.hsCode, 'AANZFTA');
    if (agreement === 'SAFTA' && SAFTA.has(origin)) return this.makePreference(args.hsCode, 'SAFTA');
    if (agreement === 'KAFTA' && KAFTA.has(origin)) return this.makePreference(args.hsCode, 'KAFTA');
    if (agreement === 'JAEPA' && JAEPA.has(origin)) return this.makePreference(args.hsCode, 'JAEPA');
    if (agreement === 'CHAFTA' && CHAFTA.has(origin)) return this.makePreference(args.hsCode, 'CHAFTA');
    if (agreement === 'CPTPP' && CPTPP.has(origin)) return this.makePreference(args.hsCode, 'CPTPP');
    if (agreement === 'RCEP' && RCEP.has(origin)) return this.makePreference(args.hsCode, 'RCEP');
    if (agreement === 'IA-CEPA' && IA_CEPA.has(origin)) return this.makePreference(args.hsCode, 'IA-CEPA');
    if (agreement === 'A-UKFTA' && A_UKFTA.has(origin)) return this.makePreference(args.hsCode, 'A-UKFTA');
    return null;
  }

  private makePreference(hsCode: string, agreement: string): TariffFormulaComponent {
    return {
      componentType: 'special',
      formula: '0',
      rateText: `${agreement} preferential (Free)`,
      identifier: `AU_${agreement}`,
      description: `Australia ${agreement} preferential rate`,
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
