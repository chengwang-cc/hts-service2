import {
  FormulaExtractorOutputSchema,
  FormulaSourcePackSchema,
} from './formula-ai-validation.schemas';
import { formulaAiSourcePackFixtures } from './formula-ai-source-pack.fixtures';

describe('formula AI validation schemas', () => {
  it('accepts a strict extractor artifact', () => {
    const artifact = FormulaExtractorOutputSchema.parse({
      modelRole: 'extractor',
      verdict: 'formula_extracted',
      components: [
        {
          componentType: 'baseDuty',
          sourceRateText: '5%',
          formulaText: 'value * 0.05',
          formulaAst: {},
          conditionAst: null,
          unitDimensions: {},
          constraints: [],
          roundingPolicy: {},
          citations: [{ field: 'rateText' }],
          testVectors: [{ inputs: { value: 100 }, expected: 5 }],
          assumptions: [],
          blockers: [],
        },
      ],
      confidence: 0.95,
      reasonCodes: [],
      needsJudge: false,
    });

    expect(artifact.components[0].formulaText).toBe('value * 0.05');
  });

  it('rejects extra fields so prompts cannot silently drift', () => {
    const parsed = FormulaExtractorOutputSchema.safeParse({
      modelRole: 'extractor',
      verdict: 'no_duty',
      components: [],
      confidence: 1,
      reasonCodes: [],
      needsJudge: false,
      extra: true,
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts the source pack shape used by the runners', () => {
    const pack = FormulaSourcePackSchema.parse({
      sourcePackId: 'abc',
      htsNumber: '0101.21.00.00',
      sourceVersion: '2026 Revision 8',
      effectiveDate: '2026-05-22',
      destinationCountry: 'US',
      originCountry: 'ALL',
      articleDescription: 'Horses',
      unit: 'No.',
      rateText: 'Free',
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
      metadata: {},
    });

    expect(pack.requiredOutputSchemaVersion).toBe('formula-artifact-v1');
  });

  it('keeps the representative source-pack fixtures schema-valid', () => {
    for (const fixture of formulaAiSourcePackFixtures) {
      expect(() => FormulaSourcePackSchema.parse(fixture.sourcePack)).not.toThrow();
    }
  });
});
