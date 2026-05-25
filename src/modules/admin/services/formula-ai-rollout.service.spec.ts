import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FormulaSemanticsService } from '../../calculator/services/formula-semantics.service';
import { FormulaAiRolloutService } from './formula-ai-rollout.service';
import { FormulaLlmComparisonService } from './formula-llm-comparison.service';
import { formulaAiSourcePackFixtures } from './formula-ai-source-pack.fixtures';
import type { FormulaExtractorOutput } from './formula-ai-validation.schemas';

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
      citations: [],
      testVectors: [{ inputs: { value: 1000 }, expectedOutput: 165 }],
      assumptions: [],
      blockers: [],
    },
  ],
  confidence: 0.94,
  reasonCodes: [],
  needsJudge: false,
};

function agent(agentRole: 'qwen_extractor' | 'codex_extractor') {
  return {
    extract: jest.fn(async () => ({
      agentRole,
      modelId: agentRole,
      promptVersion: 'formula-extractor-v1',
      promptHash: 'hash',
      rawOutput: '{}',
      sanitizedOutput: '{}',
      parsedArtifact: artifact,
      validationErrors: [],
      latencyMs: 1,
      status: 'parsed',
      metadata: {},
    })),
  };
}

function buildService(args: {
  sourcePack?: any;
  evidence?: { acceptArtifact: jest.Mock };
}) {
  return new FormulaAiRolloutService(
    { createQueryBuilder: jest.fn() } as any,
    {
      build: jest.fn(async () => args.sourcePack),
    } as any,
    agent('qwen_extractor') as any,
    agent('codex_extractor') as any,
    new FormulaLlmComparisonService(
      new FormulaSemanticsService(),
      { createPacketForScope: jest.fn() } as any,
    ),
    { judge: jest.fn() } as any,
    (args.evidence || { acceptArtifact: jest.fn() }) as any,
  );
}

describe('FormulaAiRolloutService', () => {
  let previousDir: string | undefined;
  let previousHumanRequired: string | undefined;
  let previousAutoPending: string | undefined;
  let tempDir: string;

  beforeEach(async () => {
    previousDir = process.env.FORMULA_AI_ROLLOUT_DIR;
    previousHumanRequired = process.env.FORMULA_AI_HUMAN_REVIEW_REQUIRED;
    previousAutoPending = process.env.FORMULA_AI_AUTO_PENDING_LOW_RISK;
    tempDir = await mkdtemp(join(tmpdir(), 'formula-ai-rollout-'));
    process.env.FORMULA_AI_ROLLOUT_DIR = tempDir;
  });

  afterEach(async () => {
    restore('FORMULA_AI_ROLLOUT_DIR', previousDir);
    restore('FORMULA_AI_HUMAN_REVIEW_REQUIRED', previousHumanRequired);
    restore('FORMULA_AI_AUTO_PENDING_LOW_RISK', previousAutoPending);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates fixture-backed 10-formula dry-run artifacts without agents', async () => {
    const service = buildService({});

    const run = await service.run({
      mode: 'ten_formula_dry_run',
      useFixtures: true,
      limit: 3,
      runAgents: false,
    });

    expect(run.dryRun).toBe(true);
    expect(run.summary.scanned).toBe(3);
    expect(run.summary.compared).toBe(0);
    expect(run.items[0].status).toBe('dry_run_ready');
    expect(await service.latestRun()).toEqual(expect.objectContaining({ runId: run.runId }));
  });

  it('compares agents but blocks auto-pending while human review is required', async () => {
    process.env.FORMULA_AI_HUMAN_REVIEW_REQUIRED = 'true';
    process.env.FORMULA_AI_AUTO_PENDING_LOW_RISK = 'true';
    const evidence = { acceptArtifact: jest.fn() };
    const service = buildService({ evidence });

    const run = await service.run({
      useFixtures: true,
      limit: 1,
      runAgents: true,
      autoCreatePendingEvidence: true,
    });

    expect(run.summary.compared).toBe(1);
    expect(run.summary.autoPendingCreated).toBe(0);
    expect(evidence.acceptArtifact).not.toHaveBeenCalled();
  });

  it('can auto-create pending evidence only after low-risk policy is enabled', async () => {
    process.env.FORMULA_AI_HUMAN_REVIEW_REQUIRED = 'false';
    process.env.FORMULA_AI_AUTO_PENDING_LOW_RISK = 'true';
    const evidence = {
      acceptArtifact: jest.fn(async () => ({
        evidenceCreated: 1,
        testCasesCreated: 1,
        recomputeJobId: 'job-1',
      })),
    };
    const adValoremPack = formulaAiSourcePackFixtures.find(
      (fixture) => fixture.fixtureKey === 'ad-valorem',
    )!.sourcePack;
    const service = buildService({ sourcePack: adValoremPack, evidence });

    const run = await service.run({
      htsNumbers: [adValoremPack.htsNumber],
      runAgents: true,
      autoCreatePendingEvidence: true,
    });

    expect(run.summary.autoPendingCreated).toBe(1);
    expect(evidence.acceptArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewer: 'formula-ai-rollout-auto-pending',
      }),
    );
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
