import type { FormulaSourcePack } from './formula-ai-validation.schemas';

interface SourcePackFixture {
  fixtureKey: string;
  sourcePack: FormulaSourcePack;
}

function sourcePack(
  fixtureKey: string,
  overrides: Partial<FormulaSourcePack>,
): SourcePackFixture {
  return {
    fixtureKey,
    sourcePack: {
      sourcePackId: `fixture-${fixtureKey}`,
      htsNumber: '0000.00.00.00',
      sourceVersion: 'fixture',
      effectiveDate: '2026-01-01',
      destinationCountry: 'US',
      originCountry: 'ALL',
      articleDescription: 'Fixture article',
      unit: null,
      rateText: null,
      specialRateText: null,
      otherRateText: null,
      chapter99Text: null,
      chapterNotes: [],
      sectionNotes: [],
      generalNotes: [],
      chapter99Candidates: [],
      currentFormulaArtifact: {},
      knownParserOutput: {},
      knownBrokerCases: [],
      knownProviderQuotes: [],
      knownEvidence: [],
      knownCards: [],
      requiredOutputSchemaVersion: 'formula-artifact-v1',
      metadata: { fixture: true },
      ...overrides,
    },
  };
}

export const formulaAiSourcePackFixtures: SourcePackFixture[] = [
  sourcePack('free', {
    htsNumber: '0101.21.00.00',
    articleDescription: 'Purebred breeding horses',
    unit: 'No.',
    rateText: 'Free',
  }),
  sourcePack('ad-valorem', {
    htsNumber: '6109.10.00.12',
    articleDescription: 'Cotton T-shirts',
    unit: 'doz.',
    rateText: '16.5%',
  }),
  sourcePack('specific', {
    htsNumber: '1701.12.10.00',
    articleDescription: 'Raw cane sugar',
    unit: 'kg',
    rateText: '1.4606 cents/kg',
  }),
  sourcePack('compound', {
    htsNumber: '6403.99.60.40',
    articleDescription: 'Footwear with outer soles of rubber',
    unit: 'prs.',
    rateText: '37.5% + 90 cents/pair',
  }),
  sourcePack('chapter-99', {
    htsNumber: '9903.88.03',
    articleDescription: 'Articles subject to additional duties',
    originCountry: 'CN',
    rateText: '25%',
    chapter99Candidates: [
      {
        htsNumber: '9903.88.03',
        source: 'fixture',
        countries: ['CN'],
        rateText: '25%',
      },
    ],
  }),
  sourcePack('ambiguous', {
    htsNumber: '1701.13.20.00',
    articleDescription: 'Cane sugar with note-driven minimum rates',
    unit: 'kg',
    rateText:
      'See additional U.S. note; rate varies by polarization and quota status',
    chapterNotes: [
      {
        note: 'Fixture note requiring human review',
      },
    ],
  }),
];
