import { FormulaSemanticsService } from '../../calculator/services/formula-semantics.service';
import { FormulaLlmComparisonService } from './formula-llm-comparison.service';
import type {
  FormulaExtractorOutput,
  FormulaSourcePack,
} from './formula-ai-validation.schemas';

const sourcePack: FormulaSourcePack = {
  sourcePackId: 'pack-1',
  htsNumber: '6109.10.00.12',
  sourceVersion: '2026 Revision 8',
  effectiveDate: '2026-05-22',
  destinationCountry: 'US',
  originCountry: 'ALL',
  articleDescription: 'Cotton T-shirts',
  unit: null,
  rateText: '16.5%',
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
};

function output(formulaText = 'value * 0.165'): FormulaExtractorOutput {
  return {
    modelRole: 'extractor',
    verdict: 'formula_extracted',
    components: [
      {
        componentType: 'baseDuty',
        sourceRateText: '16.5%',
        formulaText,
        formulaAst: {},
        conditionAst: null,
        unitDimensions: {},
        constraints: [],
        roundingPolicy: {},
        citations: [],
        testVectors: [],
        assumptions: [],
        blockers: [],
      },
    ],
    confidence: 0.9,
    reasonCodes: [],
    needsJudge: false,
  };
}

function service() {
  return new FormulaLlmComparisonService(new FormulaSemanticsService(), {
    createPacketForScope: jest.fn(),
  } as any);
}

describe('FormulaLlmComparisonService', () => {
  it('marks identical artifacts as matched', () => {
    const result = service().compare({
      sourcePack,
      codexOutput: output(),
      qwenOutput: output(),
    });

    expect(result.agreementStatus).toBe('matched');
    expect(result.requiresClaudeJudge).toBe(false);
    expect(result.selectedArtifact?.components[0].formulaText).toBe(
      'value * 0.165',
    );
  });

  it('marks semantically equal formulas as equivalent', () => {
    const result = service().compare({
      sourcePack,
      codexOutput: output('value * 0.165'),
      qwenOutput: output('0.165 * value'),
    });

    expect(result.agreementStatus).toBe('equivalent');
    expect(result.differences[0].severity).toBe('P3');
  });

  it('requires Claude when formulas differ materially', () => {
    const result = service().compare({
      sourcePack,
      codexOutput: output('value * 0.165'),
      qwenOutput: output('value * 0.05'),
    });

    expect(result.agreementStatus).toBe('different');
    expect(result.requiresClaudeJudge).toBe(true);
  });

  it('does not classify needs-human-review artifacts as unsupported when formulas exist', () => {
    const codexOutput = output('value * 0.075');
    codexOutput.verdict = 'needs_human_review';
    codexOutput.needsJudge = true;
    codexOutput.components[0].blockers = [
      'Chapter 99 linkage requires confirmation.',
    ];
    const qwenOutput = output('value * 0.075');

    const result = service().compare({
      sourcePack,
      codexOutput,
      qwenOutput,
    });

    expect(result.agreementStatus).toBe('different');
    expect(result.requiresClaudeJudge).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'verdict',
          severity: 'P1',
        }),
        expect.objectContaining({
          field: 'components[0].blockers',
          severity: 'P2',
        }),
      ]),
    );
  });

  it('classifies explicit unsupported verdicts as unsupported', () => {
    const codexOutput = output('value * 0.075');
    codexOutput.verdict = 'unsupported';

    const result = service().compare({
      sourcePack,
      codexOutput,
      qwenOutput: output('value * 0.075'),
    });

    expect(result.agreementStatus).toBe('unsupported');
    expect(result.requiresClaudeJudge).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
  });

  it('treats structured artifact metadata differences as material comparison gaps', () => {
    const codexOutput = output('value * 0.165');
    const qwenOutput = output('value * 0.165');
    qwenOutput.components[0].testVectors = [
      { inputs: { value: 1000 }, expectedOutput: 165 },
    ];

    const result = service().compare({
      sourcePack,
      codexOutput,
      qwenOutput,
    });

    expect(result.agreementStatus).toBe('different');
    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'components[0].testVectors',
          severity: 'P2',
        }),
      ]),
    );
  });

  it('detects deterministic parser disagreement with the selected artifact', () => {
    const result = service().parserDisagreesWithSelected(
      {
        ...sourcePack,
        knownParserOutput: { formulaText: 'value * 0.25' },
      },
      output('value * 0.165'),
    );

    expect(result).toBe(true);
  });

  it('classifies invalid combinations', () => {
    expect(
      service().compare({
        sourcePack,
        codexOutput: null,
        qwenOutput: null,
      }).agreementStatus,
    ).toBe('both_invalid');
    expect(
      service().compare({
        sourcePack,
        codexOutput: output(),
        qwenOutput: null,
      }).agreementStatus,
    ).toBe('one_invalid');
  });

  it('forces review for high-risk source packs', () => {
    const result = service().compare({
      sourcePack: {
        ...sourcePack,
        htsNumber: '9903.88.03',
        originCountry: 'CN',
        rateText: '25%',
        chapter99Candidates: [{ htsNumber: '9903.88.03' }],
      },
      codexOutput: output('value * 0.25'),
      qwenOutput: output('value * 0.25'),
    });

    expect(result.highRiskReasons).toContain('chapter_99');
    expect(result.highRiskReasons).toContain('section_301');
    expect(result.requiresHumanReview).toBe(true);
  });

  it('flags non-301 Chapter 99 program families as high risk', () => {
    const result = service().compare({
      sourcePack: {
        ...sourcePack,
        htsNumber: '9903.85.01',
        rateText: 'The duty provided in the applicable subheading + 10%',
        chapter99Candidates: [
          {
            htsNumber: '9903.85.01',
            programFamily: 'section_232',
            programAuthority: 'Section 232',
          },
        ],
      },
      codexOutput: output('value * 0.1'),
      qwenOutput: output('value * 0.1'),
    });

    expect(result.highRiskReasons).toContain('section_232');
    expect(result.highRiskReasons).toContain('chapter_99');
    expect(result.requiresHumanReview).toBe(true);
  });
});
