export interface AuthoritativeTariffSource {
  jurisdictionCode: string;
  sourceName: string;
  sourceUrl: string;
  license: string | null;
  retrievalMethod: string;
  updateCadence: string;
  parserType: string;
  metadata?: Record<string, any>;
}

export const AUTHORITATIVE_TARIFF_SOURCES: AuthoritativeTariffSource[] = [
  {
    jurisdictionCode: 'US',
    sourceName: 'USITC HTS JSON',
    sourceUrl: 'https://hts.usitc.gov/reststop/exportList?format=JSON',
    license: 'public_domain',
    retrievalMethod: 'usitc_archive',
    updateCadence: 'on_release',
    parserType: 'deterministic',
    metadata: { authority: true, evidencePriority: 100 },
  },
  {
    jurisdictionCode: 'US',
    sourceName: 'Federal Register API',
    sourceUrl: 'https://www.federalregister.gov/api/v1/',
    license: 'public_domain',
    retrievalMethod: 'http_json_api',
    updateCadence: 'daily',
    parserType: 'hybrid',
    metadata: { authority: true, evidencePriority: 90 },
  },
  {
    jurisdictionCode: 'US',
    sourceName: 'USTR Section 301',
    sourceUrl:
      'https://ustr.gov/issue-areas/enforcement/section-301-investigations',
    license: 'public',
    retrievalMethod: 'web_scrape',
    updateCadence: 'daily',
    parserType: 'hybrid',
    metadata: { authority: true, evidencePriority: 90 },
  },
  {
    jurisdictionCode: 'US',
    sourceName: 'CBP CSMS Bulletins',
    sourceUrl: 'https://content.govdelivery.com/accounts/USDHSCBP/bulletins',
    license: 'public',
    retrievalMethod: 'web_scrape',
    updateCadence: 'daily',
    parserType: 'hybrid',
    metadata: { authority: true, evidencePriority: 85 },
  },
  {
    jurisdictionCode: 'US',
    sourceName: 'CBP CROSS Rulings',
    sourceUrl: 'https://rulings.cbp.gov/',
    license: 'public',
    retrievalMethod: 'web_scrape',
    updateCadence: 'weekly',
    parserType: 'hybrid',
    metadata: { authority: true, evidencePriority: 80 },
  },
  {
    jurisdictionCode: 'GB',
    sourceName: 'HMRC Trade Tariff API',
    sourceUrl: 'https://www.trade-tariff.service.gov.uk/api/v2/',
    license: 'open_government_licence',
    retrievalMethod: 'http_json_api',
    updateCadence: 'daily',
    parserType: 'deterministic',
    metadata: { authority: true, evidencePriority: 100 },
  },
  {
    jurisdictionCode: 'EU',
    sourceName: 'EU TARIC',
    sourceUrl:
      'https://taxation-customs.ec.europa.eu/customs-4/calculation-customs-duties/customs-tariff/eu-customs-tariff-taric_en',
    license: 'public',
    retrievalMethod: 'http_json_api',
    updateCadence: 'daily',
    parserType: 'deterministic',
    metadata: { authority: true, evidencePriority: 100 },
  },
  {
    jurisdictionCode: 'CA',
    sourceName: 'CBSA Customs Tariff',
    sourceUrl:
      'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/menu-eng.html',
    license: 'open_government_licence',
    retrievalMethod: 'open_data_csv',
    updateCadence: 'on_release',
    parserType: 'deterministic',
    metadata: { authority: true, evidencePriority: 100 },
  },
  {
    jurisdictionCode: 'HK',
    sourceName: 'Hong Kong Trade and Industry',
    sourceUrl: 'https://www.tid.gov.hk/',
    license: 'public',
    retrievalMethod: 'web_scrape',
    updateCadence: 'monthly',
    parserType: 'deterministic',
    metadata: { authority: true, evidencePriority: 100 },
  },
  {
    jurisdictionCode: 'US',
    sourceName: 'Broker Golden Set',
    sourceUrl: 'internal://broker-golden-set',
    license: 'contract',
    retrievalMethod: 'open_data_csv',
    updateCadence: 'weekly',
    parserType: 'deterministic',
    metadata: { authority: false, evidencePriority: 95, validationSource: true },
  },
  {
    jurisdictionCode: 'US',
    sourceName: 'AI Service Staging',
    sourceUrl: 'internal://ai-service-staging',
    license: 'internal',
    retrievalMethod: 'http_json_api',
    updateCadence: 'on_release',
    parserType: 'hybrid',
    metadata: { authority: false, evidencePriority: 60, derivedOracle: true },
  },
];
