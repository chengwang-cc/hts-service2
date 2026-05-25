import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FormulaAiRunArtifactService } from './formula-ai-run-artifact.service';
import { FormulaExtractorPromptService } from './formula-llm-runner.service';
import type {
  FormulaAgentRunResult,
  FormulaJudgeRunResult,
} from './formula-llm-runner.service';
import type { FormulaLlmComparisonResult } from './formula-llm-comparison.service';
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

const artifact: FormulaExtractorOutput = {
  modelRole: 'extractor',
  verdict: 'formula_extracted',
  components: [
    {
      componentType: 'baseDuty',
      sourceRateText: '16.5%',
      formulaText: 'value * 0.165',
      formulaAst: {},
      conditionAst: null,
      unitDimensions: {},
      constraints: [],
      roundingPolicy: {},
      citations: [{ field: 'rateText' }],
      testVectors: [{ inputs: { value: 100 }, expectedOutput: 16.5 }],
      assumptions: [],
      blockers: [],
    },
  ],
  confidence: 0.9,
  reasonCodes: [],
  needsJudge: false,
};

function agent(agentRole: 'qwen_extractor' | 'codex_extractor'): FormulaAgentRunResult {
  const sanitizedOutput = JSON.stringify(artifact);
  return {
    agentRole,
    modelId: agentRole,
    promptVersion: 'formula-extractor-v1',
    promptHash: 'run-hash',
    rawOutput: `<think>hidden reasoning</think>${sanitizedOutput}`,
    sanitizedOutput,
    parsedArtifact: artifact,
    validationErrors: [],
    latencyMs: 1,
    status: 'parsed',
    metadata: {},
  };
}

function judge(): FormulaJudgeRunResult {
  const sanitizedOutput = JSON.stringify({
    judgeVerdict: 'both_equivalent',
    selectedArtifact: null,
    corrections: [],
    citationsUsed: [],
    riskLevel: 'P3',
    humanReviewRequired: false,
    skillFeedback: [],
  });
  return {
    agentRole: 'claude_judge',
    modelId: 'claude',
    promptVersion: 'formula-judge-v1',
    promptHash: 'judge-hash',
    rawOutput: `<think>judge reasoning</think>${sanitizedOutput}`,
    sanitizedOutput,
    parsedArtifact: JSON.parse(sanitizedOutput),
    validationErrors: [],
    latencyMs: 1,
    status: 'parsed',
    metadata: {},
  };
}

const comparison: FormulaLlmComparisonResult = {
  agreementStatus: 'matched',
  differences: [],
  requiresClaudeJudge: false,
  requiresHumanReview: false,
  selectedArtifact: artifact,
  codexSemanticHashes: ['codex'],
  qwenSemanticHashes: ['qwen'],
  highRiskReasons: [],
};

describe('FormulaAiRunArtifactService', () => {
  let previousDir: string | undefined;
  let tempDir: string;
  let service: FormulaAiRunArtifactService;

  beforeEach(async () => {
    previousDir = process.env.FORMULA_AI_COUNCIL_RUN_DIR;
    tempDir = await mkdtemp(join(tmpdir(), 'formula-ai-council-runs-'));
    process.env.FORMULA_AI_COUNCIL_RUN_DIR = tempDir;
    service = new FormulaAiRunArtifactService(new FormulaExtractorPromptService());
  });

  afterEach(async () => {
    if (previousDir === undefined) {
      delete process.env.FORMULA_AI_COUNCIL_RUN_DIR;
    } else {
      process.env.FORMULA_AI_COUNCIL_RUN_DIR = previousDir;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists replayable council run artifacts with prompt snapshots', async () => {
    const qwen = agent('qwen_extractor');
    const codex = agent('codex_extractor');
    const claude = judge();
    const persisted = await service.persistCouncilRun({
      sourcePack,
      qwen,
      codex,
      comparison,
      judge: claude,
      judgeInput: {
        sourcePack,
        codexOutput: codex.parsedArtifact,
        qwenOutput: qwen.parsedArtifact,
        comparison: {},
      },
      packet: { id: 'packet-1' },
      skillFeedback: [{ id: 'feedback-1' }],
      parserDisagrees: false,
    });

    const rawFile = await readFile(persisted.artifactPath, 'utf8');
    expect(rawFile).toContain('Source pack:');
    expect(rawFile).not.toContain('<think>');
    expect(persisted.promptSnapshots.qwen.promptText).toContain(
      'formula extraction agent',
    );
    expect(service.toSummary(persisted)).toEqual(
      expect.objectContaining({
        runId: persisted.runId,
        sourcePackId: sourcePack.sourcePackId,
      }),
    );
    await expect(service.councilRun(persisted.runId)).resolves.toEqual(
      expect.objectContaining({ runId: persisted.runId }),
    );
    await expect(service.latestCouncilRun()).resolves.toEqual(
      expect.objectContaining({ runId: persisted.runId }),
    );
  });
});
