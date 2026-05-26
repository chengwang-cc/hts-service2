import { Injectable } from '@nestjs/common';
import type {
  JurisdictionFacts,
} from '../jurisdiction/interfaces/tariff-jurisdiction-adapter.interface';

/**
 * JurisdictionFactsService
 *
 * Per-destination knowledge that doesn't belong inside an adapter's
 * arithmetic: schema labels, de minimis thresholds, VAT/GST scope notes,
 * documentation hints, and the trade-agreement matrix used to filter the
 * UI's trade-agreement picker by `(origin, destination)`.
 *
 * Stored as a data table so adding a new destination is one entry — no
 * code branching. The 10 destinations in scope for Phase A/B+ are seeded
 * here; further destinations slot in beside them.
 *
 * The `qualified` flag on `deMinimis` and the `eligible` flag on
 * `tradeAgreements` are evaluated at call time based on the goods value
 * and origin so each request sees the right answer.
 */
@Injectable()
export class JurisdictionFactsService {
  /**
   * Build a `JurisdictionFacts` block for a (destination, origin, goodsValue)
   * tuple. Pure function — safe to call multiple times per quote.
   */
  build(args: {
    destinationCountry: string;
    destinationMemberState?: string;
    originCountry: string;
    goodsValue: number;
    currency: string;
    entryDate?: string;
  }): JurisdictionFacts {
    const dest = args.destinationCountry.toUpperCase();
    const origin = (args.originCountry || '').toUpperCase();

    switch (dest) {
      case 'US':
        return this.usFacts(args.goodsValue, origin);
      case 'CA':
        return this.caFacts(args.goodsValue, origin);
      case 'GB':
        return this.gbFacts(args.goodsValue, origin);
      case 'EU':
        return this.euFacts(args.goodsValue, args.destinationMemberState, origin);
      case 'HK':
        return this.hkFacts();
      case 'KR':
        return this.krFacts(args.goodsValue, origin);
      case 'SG':
        return this.sgFacts(args.goodsValue, origin);
      case 'AU':
        return this.auFacts(args.goodsValue, origin);
      case 'NZ':
        return this.nzFacts(args.goodsValue, origin);
      case 'TW':
        return this.twFacts(args.goodsValue, origin);
      default:
        return {
          schemaName: `${dest} (no jurisdiction facts seeded)`,
          schemaEffectiveDate: this.today(),
          currency: args.currency,
          notes: [`${dest} is not yet seeded in JurisdictionFactsService.`],
        };
    }
  }

  private usFacts(goodsValue: number, origin: string): JurisdictionFacts {
    return {
      schemaName: 'USITC HTS (current revision)',
      schemaEffectiveDate: this.today(),
      currency: 'USD',
      deMinimis: {
        appliesTo: 'duty_and_tax',
        threshold: 800,
        currency: 'USD',
        qualified: goodsValue <= 800,
        note: 'Section 321 informal entry: goods ≤ USD 800 enter free of duty and tax.',
      },
      tradeAgreements: this.pickAgreements('US', origin, [
        { code: 'USMCA', label: 'United States–Mexico–Canada Agreement', origins: ['CA', 'MX'] },
        { code: 'KORUS', label: 'US–Korea FTA', origins: ['KR'] },
        { code: 'AUSFTA', label: 'US–Australia FTA', origins: ['AU'] },
        { code: 'CAFTA-DR', label: 'CAFTA-DR', origins: ['CR', 'DO', 'SV', 'GT', 'HN', 'NI'] },
        { code: 'GSP', label: 'Generalized System of Preferences', origins: [], note: 'lapsed; pending renewal' },
      ]),
      documentationRequirements: this.usDocs(origin),
    };
  }

  private caFacts(goodsValue: number, origin: string): JurisdictionFacts {
    return {
      schemaName: 'CBSA Customs Tariff (seeded)',
      schemaEffectiveDate: this.today(),
      currency: 'CAD',
      deMinimis: {
        appliesTo: 'duty_and_tax',
        threshold: origin === 'US' || origin === 'MX' ? 150 : 20,
        currency: 'CAD',
        qualified:
          (origin === 'US' || origin === 'MX') ? goodsValue <= 150 : goodsValue <= 20,
        note:
          origin === 'US' || origin === 'MX'
            ? 'CUSMA de minimis: ≤ CAD 150 duty-free, ≤ CAD 40 tax-free for postal/courier.'
            : 'General de minimis CAD 20 for non-CUSMA origins.',
      },
      vatRules: {
        appliesAt: 'border',
        standardRate: 0.05,
        note: 'GST 5% federal + per-province HST (NB/NL/NS/PE 15%, ON 13%) or PST (BC 7%, MB 7%, SK 6%, QC 9.975%).',
      },
      tradeAgreements: this.pickAgreements('CA', origin, [
        { code: 'CUSMA', label: 'Canada–US–Mexico Agreement', origins: ['US', 'MX'] },
        { code: 'CPTPP', label: 'Comprehensive and Progressive TPP', origins: ['AU', 'BN', 'CL', 'JP', 'MY', 'MX', 'NZ', 'PE', 'SG', 'VN', 'GB'] },
        { code: 'CKFTA', label: 'Canada–Korea FTA', origins: ['KR'] },
        { code: 'CETA', label: 'Canada–EU Comprehensive Economic and Trade Agreement', origins: this.euOrigins() },
      ]),
    };
  }

  private gbFacts(goodsValue: number, origin: string): JurisdictionFacts {
    return {
      schemaName: 'GOV.UK Trade Tariff (live)',
      schemaEffectiveDate: this.today(),
      currency: 'GBP',
      deMinimis: {
        appliesTo: 'duty',
        threshold: 135,
        currency: 'GBP',
        qualified: goodsValue <= 135,
        note: 'UK low-value: goods ≤ £135 — VAT collected at point-of-sale by registered seller; ≤ £135 also customs-duty-free.',
      },
      vatRules: {
        appliesAt: goodsValue <= 135 ? 'reverse_charge' : 'border',
        standardRate: 0.2,
        reducedRate: 0.05,
        note: 'UK VAT 20% standard / 5% reduced. ≤ £135 collected by registered offshore supplier.',
      },
      tradeAgreements: this.pickAgreements('GB', origin, [
        { code: 'UK-EU-TCA', label: 'UK–EU Trade and Cooperation Agreement', origins: this.euOrigins() },
        { code: 'CPTPP', label: 'Comprehensive and Progressive TPP (UK acceded 2024)', origins: ['AU', 'BN', 'CA', 'CL', 'JP', 'MY', 'MX', 'NZ', 'PE', 'SG', 'VN'] },
        { code: 'A-UKFTA', label: 'UK–Australia FTA', origins: ['AU'] },
        { code: 'NZ-UK', label: 'UK–New Zealand FTA', origins: ['NZ'] },
        { code: 'GSP-UK', label: 'UK Generalised Scheme of Preferences', origins: [] },
      ]),
    };
  }

  private euFacts(goodsValue: number, memberState: string | undefined, origin: string): JurisdictionFacts {
    const ms = (memberState || '').toUpperCase();
    return {
      schemaName: 'EU TARIC (seeded)',
      schemaEffectiveDate: this.today(),
      currency: 'EUR',
      notes: ms ? [`Member state: ${ms}.`] : ['EU customs union; member state required for VAT.'],
      deMinimis: {
        appliesTo: 'duty',
        threshold: 150,
        currency: 'EUR',
        qualified: goodsValue <= 150,
        note: 'EU IOSS threshold: goods ≤ €150 may use Import One-Stop Shop (VAT at point-of-sale).',
      },
      vatRules: {
        appliesAt: goodsValue <= 150 ? 'ioss' : 'border',
        standardRate: this.euVatRate(ms),
        note: `Member-state VAT (${ms || 'select MS'}): standard ${(this.euVatRate(ms) * 100).toFixed(0)}%.`,
      },
      tradeAgreements: this.pickAgreements('EU', origin, [
        { code: 'UK-EU-TCA', label: 'EU–UK Trade and Cooperation Agreement', origins: ['GB'] },
        { code: 'CETA', label: 'EU–Canada CETA', origins: ['CA'] },
        { code: 'EU-KOREA', label: 'EU–Korea FTA', origins: ['KR'] },
        { code: 'EU-SG', label: 'EU–Singapore FTA', origins: ['SG'] },
        { code: 'EU-VN', label: 'EU–Vietnam FTA', origins: ['VN'] },
        { code: 'GSP-EU', label: 'EU Generalised Scheme of Preferences', origins: [] },
        { code: 'GSP-PLUS', label: 'EU GSP+', origins: [] },
      ]),
    };
  }

  private hkFacts(): JurisdictionFacts {
    return {
      schemaName: 'HK free port (no general tariff)',
      schemaEffectiveDate: this.today(),
      currency: 'HKD',
      notes: [
        'Hong Kong is a free port; no general customs duty applies.',
        'Excise duty applies only to liquor, tobacco, hydrocarbon oil, and methyl alcohol.',
      ],
    };
  }

  private krFacts(goodsValue: number, origin: string): JurisdictionFacts {
    return {
      schemaName: 'Korea Customs Service HSK (seeded)',
      schemaEffectiveDate: this.today(),
      currency: 'KRW',
      deMinimis: {
        appliesTo: 'duty_and_tax',
        threshold: 200_000,
        currency: 'KRW',
        qualified: goodsValue <= 200_000,
        note: 'KR de minimis: personal-use parcels ≤ KRW 200,000 exempt from duty + VAT.',
      },
      vatRules: {
        appliesAt: 'border',
        standardRate: 0.1,
        note: 'Korea VAT 10% on customs-duty-paid CIF value.',
      },
      tradeAgreements: this.pickAgreements('KR', origin, [
        { code: 'KORUS', label: 'US–Korea FTA', origins: ['US'] },
        { code: 'KAFTA', label: 'Korea–Australia FTA', origins: ['AU'] },
        { code: 'KNZFTA', label: 'Korea–New Zealand FTA', origins: ['NZ'] },
        { code: 'KSFTA', label: 'Korea–Singapore FTA', origins: ['SG'] },
        { code: 'RCEP', label: 'RCEP', origins: this.rcepOrigins() },
        { code: 'AKFTA', label: 'ASEAN–Korea FTA', origins: this.aseanOrigins() },
        { code: 'EU-KOREA', label: 'EU–Korea FTA', origins: this.euOrigins() },
      ]),
    };
  }

  private sgFacts(goodsValue: number, origin: string): JurisdictionFacts {
    return {
      schemaName: 'Singapore Customs AHTN (seeded)',
      schemaEffectiveDate: this.today(),
      currency: 'SGD',
      notes: [
        'Singapore is a free port. Customs duty applies only to liquor, tobacco, motor vehicles, and petroleum.',
      ],
      deMinimis: {
        appliesTo: 'tax_only',
        threshold: 400,
        currency: 'SGD',
        qualified: goodsValue <= 400,
        note: 'SG LVIG/OVR threshold: GST collected at point-of-sale for shipments ≤ SGD 400 from registered offshore suppliers.',
      },
      vatRules: {
        appliesAt: goodsValue <= 400 ? 'lvig_ovr' : 'border',
        standardRate: 0.09,
        note: 'Singapore GST 9% on duty-paid CIF value (LVIG handled via OVR scheme).',
      },
      tradeAgreements: this.pickAgreements('SG', origin, [
        { code: 'AANZFTA', label: 'ASEAN–Australia–NZ FTA', origins: ['AU', 'NZ'] },
        { code: 'NZSCEP', label: 'NZ–Singapore CEP', origins: ['NZ'] },
        { code: 'KSFTA', label: 'Korea–Singapore FTA', origins: ['KR'] },
        { code: 'ASTEP', label: 'Singapore–Taiwan Economic Partnership', origins: ['TW'] },
        { code: 'USSFTA', label: 'US–Singapore FTA', origins: ['US'] },
        { code: 'EUSFTA', label: 'EU–Singapore FTA', origins: this.euOrigins() },
        { code: 'CPTPP', label: 'CPTPP', origins: this.cptppOrigins() },
        { code: 'RCEP', label: 'RCEP', origins: this.rcepOrigins() },
      ]),
    };
  }

  private auFacts(goodsValue: number, origin: string): JurisdictionFacts {
    return {
      schemaName: 'Australian Border Force Working Tariff (seeded)',
      schemaEffectiveDate: this.today(),
      currency: 'AUD',
      deMinimis: {
        appliesTo: 'tax_only',
        threshold: 1000,
        currency: 'AUD',
        qualified: goodsValue <= 1000,
        note: 'AU LVIG/OST threshold: GST collected at point-of-sale for shipments ≤ AUD 1,000 from registered offshore suppliers.',
      },
      vatRules: {
        appliesAt: goodsValue <= 1000 ? 'lvig_ovr' : 'border',
        standardRate: 0.1,
        note: 'Australia GST 10% on VoTI (Value of Taxable Importation = declared + duty + transport + insurance).',
      },
      tradeAgreements: this.pickAgreements('AU', origin, [
        { code: 'AUSFTA', label: 'US–Australia FTA', origins: ['US'] },
        { code: 'CER', label: 'Closer Economic Relations (NZ)', origins: ['NZ'] },
        { code: 'AANZFTA', label: 'ASEAN–Australia–NZ FTA', origins: ['NZ', ...this.aseanOrigins()] },
        { code: 'SAFTA', label: 'Singapore–Australia FTA', origins: ['SG'] },
        { code: 'KAFTA', label: 'Korea–Australia FTA', origins: ['KR'] },
        { code: 'JAEPA', label: 'Japan–Australia EPA', origins: ['JP'] },
        { code: 'CHAFTA', label: 'China–Australia FTA', origins: ['CN'] },
        { code: 'CPTPP', label: 'CPTPP', origins: this.cptppOrigins() },
        { code: 'RCEP', label: 'RCEP', origins: this.rcepOrigins() },
        { code: 'A-UKFTA', label: 'Australia–UK FTA', origins: ['GB'] },
        { code: 'IA-CEPA', label: 'Indonesia–Australia CEPA', origins: ['ID'] },
      ]),
    };
  }

  private nzFacts(goodsValue: number, origin: string): JurisdictionFacts {
    return {
      schemaName: 'NZ Customs Working Tariff Document (seeded)',
      schemaEffectiveDate: this.today(),
      currency: 'NZD',
      deMinimis: {
        appliesTo: 'tax_only',
        threshold: 1000,
        currency: 'NZD',
        qualified: goodsValue <= 1000,
        note: 'NZ LVIG threshold: GST collected at point-of-sale for shipments ≤ NZD 1,000 from registered offshore suppliers.',
      },
      vatRules: {
        appliesAt: goodsValue <= 1000 ? 'lvig_ovr' : 'border',
        standardRate: 0.15,
        note: 'NZ GST 15% on landed value (declared + duty + freight + insurance).',
      },
      tradeAgreements: this.pickAgreements('NZ', origin, [
        { code: 'CER', label: 'Closer Economic Relations (AU)', origins: ['AU'] },
        { code: 'NZ-CHINA', label: 'NZ–China FTA', origins: ['CN'] },
        { code: 'KNZFTA', label: 'Korea–New Zealand FTA', origins: ['KR'] },
        { code: 'NZSCEP', label: 'NZ–Singapore CEP', origins: ['SG'] },
        { code: 'AANZFTA', label: 'ASEAN–Australia–NZ FTA', origins: ['AU', ...this.aseanOrigins()] },
        { code: 'ANZTEC', label: 'NZ–Taiwan ANZTEC', origins: ['TW'] },
        { code: 'NZ-HK', label: 'NZ–HK Closer Economic Partnership', origins: ['HK'] },
        { code: 'CPTPP', label: 'CPTPP', origins: this.cptppOrigins() },
        { code: 'RCEP', label: 'RCEP', origins: this.rcepOrigins() },
        { code: 'NZ-UK', label: 'NZ–UK FTA', origins: ['GB'] },
      ]),
    };
  }

  private twFacts(goodsValue: number, origin: string): JurisdictionFacts {
    return {
      schemaName: 'Taiwan Customs Administration CCC (seeded)',
      schemaEffectiveDate: this.today(),
      currency: 'TWD',
      deMinimis: {
        appliesTo: 'duty_and_tax',
        threshold: 2000,
        currency: 'TWD',
        qualified: goodsValue <= 2000,
        note: 'TW de minimis: personal-use parcels ≤ TWD 2,000 exempt from duty + Business Tax (max 6 parcels per importer per 6-month window).',
      },
      vatRules: {
        appliesAt: 'border',
        standardRate: 0.05,
        note: 'Taiwan Business Tax 5% on customs-duty-paid CIF value.',
      },
      tradeAgreements: this.pickAgreements('TW', origin, [
        { code: 'ANZTEC', label: 'NZ–Taiwan Economic Cooperation Agreement', origins: ['NZ'] },
        { code: 'ASTEP', label: 'Singapore–Taiwan Economic Partnership', origins: ['SG'] },
      ]),
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private pickAgreements(
    destination: string,
    origin: string,
    catalog: Array<{ code: string; label: string; origins: string[]; note?: string }>,
  ): JurisdictionFacts['tradeAgreements'] {
    void destination; // reserved for future destination-specific gating
    return catalog.map((a) => ({
      code: a.code,
      label: a.note ? `${a.label} (${a.note})` : a.label,
      requiresCertificate: true,
      eligible: a.origins.includes(origin) || a.origins.length === 0,
      eligibilityReason: a.origins.includes(origin)
        ? `Origin ${origin} is a party to ${a.code}.`
        : a.origins.length === 0
          ? 'Coverage depends on per-country GSP list — verify offline.'
          : `Origin ${origin} is not a party to ${a.code}.`,
    }));
  }

  private usDocs(origin: string): JurisdictionFacts['documentationRequirements'] {
    const docs: NonNullable<JurisdictionFacts['documentationRequirements']> = [];
    if (origin === 'CA' || origin === 'MX') {
      docs.push({
        code: 'USMCA_CO',
        label: 'USMCA Certificate of Origin',
        requiredFor: 'preferential_rate',
      });
    }
    if (origin === 'KR') {
      docs.push({
        code: 'KORUS_CO',
        label: 'KORUS Certificate of Origin',
        requiredFor: 'preferential_rate',
      });
    }
    return docs.length > 0 ? docs : undefined;
  }

  private euVatRate(ms: string): number {
    // Standard rates from seed-jurisdictions.ts (TaxRuleEntity seed).
    const rates: Record<string, number> = {
      AT: 0.2, BE: 0.21, BG: 0.2, CY: 0.19, CZ: 0.21, DE: 0.19, DK: 0.25,
      EE: 0.22, ES: 0.21, FI: 0.255, FR: 0.2, GR: 0.24, HR: 0.25, HU: 0.27,
      IE: 0.23, IT: 0.22, LT: 0.21, LU: 0.17, LV: 0.21, MT: 0.18, NL: 0.21,
      PL: 0.23, PT: 0.23, RO: 0.19, SE: 0.25, SI: 0.22, SK: 0.23,
    };
    return rates[ms] ?? 0.2;
  }

  private euOrigins(): string[] {
    return [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
      'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    ];
  }

  private aseanOrigins(): string[] {
    return ['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN'];
  }

  private rcepOrigins(): string[] {
    return [...this.aseanOrigins(), 'AU', 'NZ', 'CN', 'JP', 'KR'];
  }

  private cptppOrigins(): string[] {
    return ['AU', 'BN', 'CA', 'CL', 'JP', 'MY', 'MX', 'NZ', 'PE', 'SG', 'VN', 'GB'];
  }
}
