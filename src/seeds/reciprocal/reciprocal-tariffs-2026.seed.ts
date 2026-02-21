export type ReciprocalTariff2026SeedRow = {
  taxCode: string;
  taxName: string;
  description: string;
  countryCode: string;
  extraRateType: 'ADD_ON' | 'CONDITIONAL';
  rateText: string;
  rateFormula: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  legalReference: string;
  notes: string;
  conditions: Record<string, any> | null;
  priority: number;
};

const reciprocalFrameworkCountryRates: Array<{ countryCode: string; ratePercent: number }> = [
  { countryCode: 'CN', ratePercent: 54 },
  { countryCode: 'EU', ratePercent: 20 },
  { countryCode: 'VN', ratePercent: 46 },
  { countryCode: 'TW', ratePercent: 32 },
  { countryCode: 'JP', ratePercent: 24 },
  { countryCode: 'IN', ratePercent: 26 },
  { countryCode: 'KR', ratePercent: 25 },
  { countryCode: 'TH', ratePercent: 36 },
  { countryCode: 'CH', ratePercent: 31 },
  { countryCode: 'ID', ratePercent: 32 },
  { countryCode: 'MY', ratePercent: 24 },
  { countryCode: 'KH', ratePercent: 49 },
  { countryCode: 'ZA', ratePercent: 30 },
  { countryCode: 'BD', ratePercent: 37 },
  { countryCode: 'IL', ratePercent: 17 },
  { countryCode: 'PH', ratePercent: 17 },
  { countryCode: 'PK', ratePercent: 29 },
  { countryCode: 'LK', ratePercent: 44 },
  { countryCode: 'NI', ratePercent: 18 },
  { countryCode: 'NO', ratePercent: 15 },
  { countryCode: 'JO', ratePercent: 20 },
  { countryCode: 'MG', ratePercent: 47 },
  { countryCode: 'MM', ratePercent: 44 },
  { countryCode: 'TN', ratePercent: 28 },
  { countryCode: 'KZ', ratePercent: 27 },
  { countryCode: 'RS', ratePercent: 37 },
  { countryCode: 'CI', ratePercent: 21 },
  { countryCode: 'LA', ratePercent: 48 },
  { countryCode: 'BW', ratePercent: 37 },
  { countryCode: 'NF', ratePercent: 29 },
  { countryCode: 'RE', ratePercent: 37 },
  { countryCode: 'MW', ratePercent: 17 },
  { countryCode: 'ZW', ratePercent: 18 },
  { countryCode: 'SY', ratePercent: 41 },
  { countryCode: 'VU', ratePercent: 22 },
  { countryCode: 'PM', ratePercent: 50 },
  { countryCode: 'NR', ratePercent: 30 },
  { countryCode: 'GQ', ratePercent: 12 },
  { countryCode: 'LY', ratePercent: 31 },
  { countryCode: 'TD', ratePercent: 13 },
];

const frameworkSeedRows: ReciprocalTariff2026SeedRow[] = reciprocalFrameworkCountryRates.map(
  ({ countryCode, ratePercent }) => ({
    taxCode: `RECIP_FRAMEWORK_${countryCode}`,
    taxName: `Reciprocal Tariff Framework (${countryCode})`,
    description:
      'Country-level reciprocal tariff framework rate captured for 2026 reference; Annex applicability must be confirmed before charge execution.',
    countryCode,
    extraRateType: 'CONDITIONAL',
    rateText: `${ratePercent}% ad valorem`,
    rateFormula: `value * ${(ratePercent / 100).toFixed(4)}`,
    effectiveDate: '2025-04-07',
    expirationDate: null,
    legalReference:
      'White House reciprocal tariff framework action (April 7, 2025) and subsequent policy notices',
    notes:
      'Framework policy row: requires annex mapping confirmation to execute in calculator runtime.',
    conditions: {
      requiresAnnexMapping: true,
      frameworkRateOnly: true,
    },
    priority: 8,
  }),
);

export const reciprocalTariffs2026Seed: ReciprocalTariff2026SeedRow[] = [
  {
    taxCode: 'RECIP_BASELINE_9903_01_25',
    taxName: 'Reciprocal Tariff Baseline',
    description:
      'Baseline reciprocal tariff layer for imports entered under heading 9903.01.25.',
    countryCode: 'ALL',
    extraRateType: 'ADD_ON',
    rateText: '10% ad valorem',
    rateFormula: 'value * 0.10',
    effectiveDate: '2025-04-05',
    expirationDate: null,
    legalReference:
      'IEEPA reciprocal tariff framework; CBP implementation guidance for heading 9903.01.25',
    notes:
      'Seeded baseline reciprocal tariff for 2026 operations. Country-specific exceptions are represented by conditional rows.',
    conditions: {
      htsHeading: '9903.01.25',
    },
    priority: 15,
  },
  {
    taxCode: 'RECIP_CA_EXCEPTION_9903_01_26',
    taxName: 'Reciprocal Tariff Exception (Canada/USMCA)',
    description:
      'Policy exception marker for imports entered under heading 9903.01.26 where baseline reciprocal tariffs are excluded.',
    countryCode: 'CA',
    extraRateType: 'CONDITIONAL',
    rateText: '0% (exception marker)',
    rateFormula: '0',
    effectiveDate: '2025-04-05',
    expirationDate: null,
    legalReference: 'CBP reciprocal tariff exception references for heading 9903.01.26',
    notes:
      'Conditional policy row used to suppress baseline reciprocal tariffs when exception heading 9903.01.26 is selected.',
    conditions: {
      exceptionHeading: '9903.01.26',
      excludesReciprocalBaseline: true,
    },
    priority: 5,
  },
  {
    taxCode: 'RECIP_MX_EXCEPTION_9903_01_27',
    taxName: 'Reciprocal Tariff Exception (Mexico/USMCA)',
    description:
      'Policy exception marker for imports entered under heading 9903.01.27 where baseline reciprocal tariffs are excluded.',
    countryCode: 'MX',
    extraRateType: 'CONDITIONAL',
    rateText: '0% (exception marker)',
    rateFormula: '0',
    effectiveDate: '2025-04-05',
    expirationDate: null,
    legalReference: 'CBP reciprocal tariff exception references for heading 9903.01.27',
    notes:
      'Conditional policy row used to suppress baseline reciprocal tariffs when exception heading 9903.01.27 is selected.',
    conditions: {
      exceptionHeading: '9903.01.27',
      excludesReciprocalBaseline: true,
    },
    priority: 5,
  },
  ...frameworkSeedRows,
];
