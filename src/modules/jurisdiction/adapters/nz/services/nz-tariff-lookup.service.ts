import { Injectable, Logger } from '@nestjs/common';
import {
  FormulaVariable,
  SourceCitationRef,
  TariffApplyCondition,
  TariffFormulaComponent,
} from '../../../../calculator/services/tariff-types';

/**
 * NzTariffLookupService
 *
 * NZ Customs maintains the Working Tariff Document. Most rates are 0% or
 * 5%. Until a scheduled ingestion lands, seeded HS6 mini-table is used;
 * unmapped codes default to 5% (NZ's typical general rate) with a warning.
 *
 * Preferential rates engage via `preferentialOverride()` for: CER (with
 * AU), KNZFTA (with KR), NZ-China FTA, NZSCEP (with SG), AANZFTA, ANZTEC
 * (with TW), NZ-HK CEP, NZ-Korea, NZ-Malaysia, CPTPP, RCEP, PACER Plus,
 * A-UKFTA.
 *
 * Source: https://www.customs.govt.nz/business/tariffs/working-tariff-document/
 */
@Injectable()
export class NzTariffLookupService {
  private readonly logger = new Logger(NzTariffLookupService.name);

  private readonly MFN_BY_HS6: Record<string, number> = {
    // Apparel — 10% in NZ (higher than AU)
    '610910': 0.1, // T-shirts
    '620342': 0.1, // Men's trousers
    // Footwear
    '640399': 0.1,
    // Electronics — free
    '851712': 0,
    '852872': 0,
    '847130': 0,
    // Cosmetics
    '330499': 0.05,
    // Bags / wallets
    '420232': 0.05,
    // Toys — free
    '950300': 0,
    // Motor vehicles
    '870323': 0,
  };

  private readonly citation: SourceCitationRef = {
    source: 'NZ Customs Working Tariff Document',
    url: 'https://www.customs.govt.nz/business/tariffs/working-tariff-document/',
    confidence: 0.7,
    parserMethod: 'nz_seed_table',
  };

  lookupMfn(hsCode: string): TariffFormulaComponent {
    const digits = (hsCode || '').replace(/\D/g, '');
    const hs6 = digits.slice(0, 6);
    const rate = this.MFN_BY_HS6[hs6];
    const always: TariffApplyCondition = { kind: 'always' };
    const vars: FormulaVariable[] = [
      { name: 'value', type: 'number', description: 'Declared value (NZD)' },
    ];

    if (rate === undefined) {
      this.logger.debug(`NZ MFN rate unknown for HS6=${hs6}; defaulting to 5% + warning`);
      return {
        componentType: 'base',
        formula: 'value * 0.05',
        rateText: '5% MFN (default; seeded table miss — review required)',
        identifier: `NZ_MFN_${hs6}_DEFAULT`,
        description: 'New Zealand MFN duty (defaulted to 5%)',
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
      identifier: `NZ_MFN_${hs6}`,
      description: 'New Zealand MFN duty',
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

    const CER = new Set(['AU']);
    const NZ_CHINA = new Set(['CN']);
    const KNZFTA = new Set(['KR']);
    const NZSCEP = new Set(['SG']);
    const AANZFTA = new Set(['AU', 'BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN']);
    const ANZTEC = new Set(['TW']);
    const NZ_HK = new Set(['HK']);
    const NZ_MALAYSIA = new Set(['MY']);
    const CPTPP = new Set(['AU', 'BN', 'CA', 'CL', 'JP', 'MY', 'MX', 'PE', 'SG', 'VN', 'GB']);
    const RCEP = new Set(['AU', 'BN', 'KH', 'CN', 'ID', 'JP', 'KR', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN']);
    const A_UKFTA = new Set(['GB']);

    if (agreement === 'CER' && CER.has(origin)) return this.makePreference(args.hsCode, 'CER');
    if (agreement === 'NZ-CHINA' && NZ_CHINA.has(origin)) return this.makePreference(args.hsCode, 'NZ-CHINA');
    if (agreement === 'KNZFTA' && KNZFTA.has(origin)) return this.makePreference(args.hsCode, 'KNZFTA');
    if (agreement === 'NZSCEP' && NZSCEP.has(origin)) return this.makePreference(args.hsCode, 'NZSCEP');
    if (agreement === 'AANZFTA' && AANZFTA.has(origin)) return this.makePreference(args.hsCode, 'AANZFTA');
    if (agreement === 'ANZTEC' && ANZTEC.has(origin)) return this.makePreference(args.hsCode, 'ANZTEC');
    if (agreement === 'NZ-HK' && NZ_HK.has(origin)) return this.makePreference(args.hsCode, 'NZ-HK');
    if (agreement === 'NZ-MY' && NZ_MALAYSIA.has(origin)) return this.makePreference(args.hsCode, 'NZ-MY');
    if (agreement === 'CPTPP' && CPTPP.has(origin)) return this.makePreference(args.hsCode, 'CPTPP');
    if (agreement === 'RCEP' && RCEP.has(origin)) return this.makePreference(args.hsCode, 'RCEP');
    if (agreement === 'A-UKFTA' && A_UKFTA.has(origin)) return this.makePreference(args.hsCode, 'A-UKFTA');
    return null;
  }

  private makePreference(hsCode: string, agreement: string): TariffFormulaComponent {
    return {
      componentType: 'special',
      formula: '0',
      rateText: `${agreement} preferential (Free)`,
      identifier: `NZ_${agreement}`,
      description: `New Zealand ${agreement} preferential rate`,
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
