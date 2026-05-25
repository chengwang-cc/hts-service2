export type CountryParserReadiness =
  | 'production'
  | 'shadow'
  | 'pilot'
  | 'planned';

export interface CountryTariffParserRegistryEntry {
  jurisdictionCode: string;
  destinationCode: string;
  adapterKey: string;
  sourceNames: string[];
  parserNames: string[];
  readiness: CountryParserReadiness;
  supportedComponents: string[];
  unsupportedComponents: string[];
  validationRules?: string[];
  aiPromptProfile?: string;
  automation: {
    sourceMonitor: boolean;
    evidenceBackfill: boolean;
    cardRecompute: boolean;
    oracleComparison: boolean;
    brokerGoldenSet: boolean;
  };
  aiAssist: {
    policyExtraction: boolean;
    formulaNormalization: boolean;
    rulingRetrieval: boolean;
    reconciliationDrafting: boolean;
  };
  nextMilestone: string;
}

export const COUNTRY_TARIFF_PARSER_REGISTRY: CountryTariffParserRegistryEntry[] =
  [
    {
      jurisdictionCode: 'US',
      destinationCode: 'US',
      adapterKey: 'us-hts',
      sourceNames: [
        'USITC HTS JSON',
        'Federal Register API',
        'USTR Section 301',
        'CBP CSMS Bulletins',
        'CBP CROSS Rulings',
      ],
      parserNames: ['usitc-hts', 'federal-register-policy', 'cbp-cross'],
      readiness: 'production',
      supportedComponents: [
        'base',
        'special',
        'non_ntr',
        'chapter_99',
        'section_301',
        'section_232',
        'mpf',
        'hmf',
      ],
      unsupportedComponents: [],
      validationRules: [
        'Reject unknown units unless mapped to canonical dimensions.',
        'Treat AI output as pending evidence only.',
        'Require Chapter 99 applicability conditions to stay componentized.',
      ],
      aiPromptProfile: 'us-hts-policy-and-rate-components-v1',
      automation: {
        sourceMonitor: true,
        evidenceBackfill: true,
        cardRecompute: true,
        oracleComparison: true,
        brokerGoldenSet: true,
      },
      aiAssist: {
        policyExtraction: true,
        formulaNormalization: true,
        rulingRetrieval: true,
        reconciliationDrafting: true,
      },
      nextMilestone:
        'Keep expanding broker golden-set coverage by chapter and country exposure.',
    },
    {
      jurisdictionCode: 'GB',
      destinationCode: 'GB',
      adapterKey: 'gb-trade-tariff',
      sourceNames: ['HMRC Trade Tariff API'],
      parserNames: ['gb-trade-tariff-api'],
      readiness: 'shadow',
      supportedComponents: ['base', 'measure', 'vat', 'controls'],
      unsupportedComponents: ['quota', 'safeguard'],
      validationRules: [
        'Preserve measure type and geographical area from HMRC API responses.',
        'Validate VAT separately from customs duty.',
      ],
      aiPromptProfile: 'gb-trade-tariff-measures-v1',
      automation: {
        sourceMonitor: true,
        evidenceBackfill: true,
        cardRecompute: true,
        oracleComparison: false,
        brokerGoldenSet: false,
      },
      aiAssist: {
        policyExtraction: true,
        formulaNormalization: true,
        rulingRetrieval: false,
        reconciliationDrafting: true,
      },
      nextMilestone:
        'Add provider oracle coverage and broker examples for VAT and measure edge cases.',
    },
    {
      jurisdictionCode: 'EU',
      destinationCode: 'EU',
      adapterKey: 'eu-taric',
      sourceNames: ['EU TARIC'],
      parserNames: ['eu-taric-api'],
      readiness: 'shadow',
      supportedComponents: ['base', 'measure', 'vat', 'ioss', 'controls'],
      unsupportedComponents: ['quota', 'anti_dumping'],
      validationRules: [
        'Resolve EU member-state VAT context before confidence scoring.',
        'Do not flatten TARIC measures with different additional codes.',
      ],
      aiPromptProfile: 'eu-taric-measures-v1',
      automation: {
        sourceMonitor: true,
        evidenceBackfill: true,
        cardRecompute: true,
        oracleComparison: false,
        brokerGoldenSet: false,
      },
      aiAssist: {
        policyExtraction: true,
        formulaNormalization: true,
        rulingRetrieval: false,
        reconciliationDrafting: true,
      },
      nextMilestone:
        'Split readiness by member-state VAT and validate IOSS low-value scenarios.',
    },
    {
      jurisdictionCode: 'CA',
      destinationCode: 'CA',
      adapterKey: 'ca-customs',
      sourceNames: ['CBSA Customs Tariff'],
      parserNames: ['ca-customs-tariff'],
      readiness: 'pilot',
      supportedComponents: ['base', 'gst_hst', 'low_value'],
      unsupportedComponents: ['sima', 'excise'],
      validationRules: [
        'Keep GST/HST and customs duty as separate calculation stages.',
        'Escalate SIMA and excise language until deterministic parsers exist.',
      ],
      aiPromptProfile: 'ca-customs-gst-hst-v1',
      automation: {
        sourceMonitor: true,
        evidenceBackfill: true,
        cardRecompute: false,
        oracleComparison: false,
        brokerGoldenSet: false,
      },
      aiAssist: {
        policyExtraction: true,
        formulaNormalization: true,
        rulingRetrieval: false,
        reconciliationDrafting: true,
      },
      nextMilestone:
        'Promote customs tariff parser output into evidence cards and add GST/HST golden-set cases.',
    },
    {
      jurisdictionCode: 'HK',
      destinationCode: 'HK',
      adapterKey: 'hk-free-port',
      sourceNames: ['Hong Kong Trade and Industry'],
      parserNames: ['hk-dutiable-commodity'],
      readiness: 'pilot',
      supportedComponents: ['base', 'dutiable_commodity', 'controls'],
      unsupportedComponents: ['excise_permit_edge_cases'],
      validationRules: [
        'Default customs duty to free port behavior unless commodity is dutiable.',
        'Escalate permit and controlled-goods conditions.',
      ],
      aiPromptProfile: 'hk-dutiable-commodities-v1',
      automation: {
        sourceMonitor: true,
        evidenceBackfill: false,
        cardRecompute: false,
        oracleComparison: false,
        brokerGoldenSet: false,
      },
      aiAssist: {
        policyExtraction: true,
        formulaNormalization: true,
        rulingRetrieval: false,
        reconciliationDrafting: true,
      },
      nextMilestone:
        'Backfill evidence for dutiable commodities and add controlled-goods regression cases.',
    },
    {
      jurisdictionCode: 'AU',
      destinationCode: 'AU',
      adapterKey: 'au-customs-planned',
      sourceNames: ['Australian Border Force Working Tariff'],
      parserNames: ['planned-au-working-tariff'],
      readiness: 'planned',
      supportedComponents: [],
      unsupportedComponents: ['base', 'gst', 'dumping', 'excise'],
      validationRules: [
        'Build deterministic Working Tariff parser before evidence promotion.',
        'Keep GST, dumping, and excise components separate.',
      ],
      aiPromptProfile: 'au-working-tariff-planned-v1',
      automation: {
        sourceMonitor: false,
        evidenceBackfill: false,
        cardRecompute: false,
        oracleComparison: false,
        brokerGoldenSet: false,
      },
      aiAssist: {
        policyExtraction: true,
        formulaNormalization: true,
        rulingRetrieval: false,
        reconciliationDrafting: true,
      },
      nextMilestone:
        'Create deterministic source adapter before allowing AI-assisted formula drafts into review.',
    },
    {
      jurisdictionCode: 'SG',
      destinationCode: 'SG',
      adapterKey: 'sg-customs-planned',
      sourceNames: ['Singapore Customs'],
      parserNames: ['planned-sg-customs'],
      readiness: 'planned',
      supportedComponents: [],
      unsupportedComponents: ['base', 'gst', 'excise', 'permit_controls'],
      validationRules: [
        'Separate GST from customs and excise duty.',
        'Escalate permit-control applicability to reviewer packets.',
      ],
      aiPromptProfile: 'sg-customs-planned-v1',
      automation: {
        sourceMonitor: false,
        evidenceBackfill: false,
        cardRecompute: false,
        oracleComparison: false,
        brokerGoldenSet: false,
      },
      aiAssist: {
        policyExtraction: true,
        formulaNormalization: true,
        rulingRetrieval: false,
        reconciliationDrafting: true,
      },
      nextMilestone:
        'Define source ingestion contract and collect broker examples for GST/import-permit cases.',
    },
    {
      jurisdictionCode: 'JP',
      destinationCode: 'JP',
      adapterKey: 'jp-customs-planned',
      sourceNames: ['Japan Customs Tariff Schedule'],
      parserNames: ['planned-jp-customs-tariff'],
      readiness: 'planned',
      supportedComponents: [],
      unsupportedComponents: ['base', 'consumption_tax', 'temporary_rates'],
      validationRules: [
        'Separate customs duty from consumption tax.',
        'Escalate temporary tariff measures until effective-date parsing exists.',
      ],
      aiPromptProfile: 'jp-customs-planned-v1',
      automation: {
        sourceMonitor: false,
        evidenceBackfill: false,
        cardRecompute: false,
        oracleComparison: false,
        brokerGoldenSet: false,
      },
      aiAssist: {
        policyExtraction: true,
        formulaNormalization: true,
        rulingRetrieval: false,
        reconciliationDrafting: true,
      },
      nextMilestone:
        'Create source adapter and seed broker examples for consumption-tax scenarios.',
    },
    {
      jurisdictionCode: 'KR',
      destinationCode: 'KR',
      adapterKey: 'kr-customs-planned',
      sourceNames: ['Korea Customs Service Tariff'],
      parserNames: ['planned-kr-customs-tariff'],
      readiness: 'planned',
      supportedComponents: [],
      unsupportedComponents: ['base', 'vat', 'fta_preference', 'safeguard'],
      validationRules: [
        'Model FTA preference claims separately from general customs duty.',
        'Escalate safeguard and quota measures until condition AST support exists.',
      ],
      aiPromptProfile: 'kr-customs-planned-v1',
      automation: {
        sourceMonitor: false,
        evidenceBackfill: false,
        cardRecompute: false,
        oracleComparison: false,
        brokerGoldenSet: false,
      },
      aiAssist: {
        policyExtraction: true,
        formulaNormalization: true,
        rulingRetrieval: false,
        reconciliationDrafting: true,
      },
      nextMilestone:
        'Define KCS source contract and collect FTA preference validation cases.',
    },
    {
      jurisdictionCode: 'MX',
      destinationCode: 'MX',
      adapterKey: 'mx-customs-planned',
      sourceNames: ['Mexico TIGIE Tariff'],
      parserNames: ['planned-mx-tigie'],
      readiness: 'planned',
      supportedComponents: [],
      unsupportedComponents: ['base', 'iva', 'dta', 'countervailing'],
      validationRules: [
        'Keep IVA and customs processing fees distinct from customs duty.',
        'Escalate countervailing and sector-program measures.',
      ],
      aiPromptProfile: 'mx-tigie-planned-v1',
      automation: {
        sourceMonitor: false,
        evidenceBackfill: false,
        cardRecompute: false,
        oracleComparison: false,
        brokerGoldenSet: false,
      },
      aiAssist: {
        policyExtraction: true,
        formulaNormalization: true,
        rulingRetrieval: false,
        reconciliationDrafting: true,
      },
      nextMilestone:
        'Create TIGIE source adapter and seed DTA/IVA broker golden-set cases.',
    },
  ];
