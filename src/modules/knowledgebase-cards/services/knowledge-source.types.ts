export interface SourceFeed {
  sourceId?: string;
  name: string;
  url: string;
  sourceType?: 'rss' | 'html' | 'document' | 'api' | 'sitemap' | string;
  /**
   * `true` when the URL is an RSS / Atom feed (parse items + ingest each).
   * `false` when the URL is a single document or landing page.
   */
  asRssFeed?: boolean;
  /** Maximum items to ingest per feed pass. */
  itemLimit?: number;
  hint?: { jurisdiction?: string; documentType?: string };
  metadata?: Record<string, unknown> | null;
  requiresReview?: boolean;
}

export const DEFAULT_SOURCE_FEEDS: readonly SourceFeed[] = [
  {
    name: 'CBP CSMS - Customs Service Messaging',
    url: 'https://content.govdelivery.com/accounts/USDHSCBP/bulletins.rss',
    sourceType: 'rss',
    asRssFeed: true,
    itemLimit: 25,
    hint: { jurisdiction: 'US', documentType: 'csms' },
    metadata: {
      publisher: 'U.S. Customs and Border Protection',
      category: 'customs-policy',
      trustTier: 'official',
    },
  },
  {
    name: 'Federal Register - USTR Documents',
    url: 'https://www.federalregister.gov/agencies/trade-representative-office-of-united-states/documents.rss',
    sourceType: 'rss',
    asRssFeed: true,
    itemLimit: 25,
    hint: { jurisdiction: 'US', documentType: 'fr-notice' },
    metadata: {
      publisher: 'Office of the U.S. Trade Representative',
      category: 'trade-remedy-policy',
      trustTier: 'official',
    },
  },
  {
    name: 'USITC Harmonized Tariff Information',
    url: 'https://www.usitc.gov/harmonized_tariff_information',
    sourceType: 'html',
    asRssFeed: false,
    itemLimit: 1,
    hint: { jurisdiction: 'US', documentType: 'tariff-schedule' },
    metadata: {
      publisher: 'U.S. International Trade Commission',
      category: 'tariff-schedule',
      trustTier: 'official',
    },
  },
  {
    name: 'EU Commission - CBAM',
    url: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en',
    sourceType: 'html',
    asRssFeed: false,
    itemLimit: 1,
    hint: { jurisdiction: 'EU', documentType: 'eu-regulation' },
    metadata: {
      publisher: 'European Commission',
      category: 'cbam',
      trustTier: 'official',
    },
  },
  {
    name: 'GOV.UK Trade Tariff API',
    url: 'https://www.trade-tariff.service.gov.uk/uk/api',
    sourceType: 'api',
    asRssFeed: false,
    itemLimit: 1,
    hint: { jurisdiction: 'GB', documentType: 'tariff-schedule' },
    metadata: {
      publisher: 'HM Revenue & Customs',
      category: 'tariff-api',
      trustTier: 'official',
    },
  },
  {
    name: 'EU TARIC Consultation',
    url: 'https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp',
    sourceType: 'html',
    asRssFeed: false,
    itemLimit: 1,
    hint: { jurisdiction: 'EU', documentType: 'tariff-schedule' },
    metadata: {
      publisher: 'European Commission - TAXUD',
      category: 'tariff-schedule',
      trustTier: 'official',
      freshnessSlaHours: 24,
    },
  },
  {
    name: 'CBP CROSS Rulings',
    url: 'https://rulings.cbp.gov/api/search',
    sourceType: 'api',
    asRssFeed: false,
    itemLimit: 25,
    hint: { jurisdiction: 'US', documentType: 'ruling' },
    metadata: {
      publisher: 'U.S. Customs and Border Protection',
      category: 'rulings',
      trustTier: 'official',
      freshnessSlaHours: 24,
    },
  },
  {
    name: 'Canada Customs Tariff (CBSA)',
    url: 'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/menu-eng.html',
    sourceType: 'html',
    asRssFeed: false,
    itemLimit: 1,
    hint: { jurisdiction: 'CA', documentType: 'tariff-schedule' },
    metadata: {
      publisher: 'Canada Border Services Agency',
      category: 'tariff-schedule',
      trustTier: 'official',
      freshnessSlaHours: 48,
    },
  },
  {
    name: 'Australia ABF — Tariff Concessions',
    url: 'https://www.abf.gov.au/importing-exporting-and-manufacturing/tariff-classification',
    sourceType: 'html',
    asRssFeed: false,
    itemLimit: 1,
    hint: { jurisdiction: 'AU', documentType: 'tariff-schedule' },
    metadata: {
      publisher: 'Australian Border Force',
      category: 'tariff-schedule',
      trustTier: 'official',
      freshnessSlaHours: 72,
    },
  },
  {
    name: 'Singapore Customs Tariff',
    url: 'https://www.customs.gov.sg/businesses/valuation-duties-taxes-fees/tariff-classification',
    sourceType: 'html',
    asRssFeed: false,
    itemLimit: 1,
    hint: { jurisdiction: 'SG', documentType: 'tariff-schedule' },
    metadata: {
      publisher: 'Singapore Customs',
      category: 'tariff-schedule',
      trustTier: 'official',
      freshnessSlaHours: 72,
    },
  },
  {
    name: 'Korea Customs Service',
    url: 'https://unipass.customs.go.kr/clip/index.do',
    sourceType: 'html',
    asRssFeed: false,
    itemLimit: 1,
    hint: { jurisdiction: 'KR', documentType: 'tariff-schedule' },
    metadata: {
      publisher: 'Korea Customs Service',
      category: 'tariff-schedule',
      trustTier: 'official',
      freshnessSlaHours: 72,
    },
  },
  {
    name: 'New Zealand Customs Tariff',
    url: 'https://www.customs.govt.nz/business/tariff-classification/',
    sourceType: 'html',
    asRssFeed: false,
    itemLimit: 1,
    hint: { jurisdiction: 'NZ', documentType: 'tariff-schedule' },
    metadata: {
      publisher: 'New Zealand Customs Service',
      category: 'tariff-schedule',
      trustTier: 'official',
      freshnessSlaHours: 72,
    },
  },
];
