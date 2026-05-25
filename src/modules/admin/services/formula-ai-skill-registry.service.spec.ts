import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FormulaAiSkillRegistryService } from './formula-ai-skill-registry.service';

describe('FormulaAiSkillRegistryService', () => {
  let previousPath: string | undefined;
  let tempDir: string;
  let service: FormulaAiSkillRegistryService;

  beforeEach(async () => {
    previousPath = process.env.FORMULA_AI_REGISTRY_PATH;
    tempDir = await mkdtemp(join(tmpdir(), 'formula-ai-registry-'));
    process.env.FORMULA_AI_REGISTRY_PATH = join(tempDir, 'registry.json');
    service = new FormulaAiSkillRegistryService();
  });

  afterEach(async () => {
    if (previousPath === undefined) {
      delete process.env.FORMULA_AI_REGISTRY_PATH;
    } else {
      process.env.FORMULA_AI_REGISTRY_PATH = previousPath;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates a default registry with promoted extractor and judge versions', async () => {
    const snapshot = await service.snapshot();

    expect(snapshot.activeVersions.extractor).toBe('extractor:formula-extractor-v1');
    expect(snapshot.activeVersions.judge).toBe('judge:formula-judge-v1');
    expect(snapshot.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'extractor:formula-extractor-v1',
          status: 'promoted',
        }),
        expect.objectContaining({
          id: 'judge:formula-judge-v1',
          status: 'promoted',
        }),
      ]),
    );
  });

  it('supports propose, holdout, approve, promote, feedback, and rollback flow', async () => {
    const version = await service.proposeVersion({
      skill: 'extractor',
      promptVersion: 'formula-extractor-v2',
      rubricVersion: 'formula-extractor-rubric-v2',
      promptBody:
        'Extract formula JSON with citations, unit dimensions, compound formulas, and test vector coverage.',
      rubricBody:
        'Reject ambiguous source language. Route Chapter 99 and note-derived rates to human review.',
      createdBy: 'reviewer@example.com',
    });

    expect(version.status).toBe('draft');

    const holdout = await service.runHoldoutEvaluation({
      skill: 'extractor',
      versionId: version.id,
    });
    expect(holdout.metrics.fixtureCount).toBeGreaterThan(0);
    expect(holdout.metrics.score).toBe(1);

    await service.approveVersion({
      skill: 'extractor',
      versionId: version.id,
      actor: 'lead@example.com',
    });
    const promoted = await service.promoteVersion({
      skill: 'extractor',
      versionId: version.id,
      actor: 'lead@example.com',
    });
    expect(promoted.status).toBe('promoted');

    const feedback = await service.recordFeedback({
      source: 'human',
      targetSkill: 'extractor',
      reviewer: 'lead@example.com',
      severity: 'P2',
      message: 'Improve unit conversion examples.',
    });
    expect(feedback.targetVersionId).toBe(version.id);

    const rollback = await service.rollbackVersion({
      skill: 'extractor',
      targetVersionId: 'extractor:formula-extractor-v1',
      actor: 'lead@example.com',
    });
    expect(rollback.id).toBe('extractor:formula-extractor-v1');

    const snapshot = await service.snapshot();
    expect(snapshot.activeVersions.extractor).toBe('extractor:formula-extractor-v1');
    expect(snapshot.feedback.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.promotionEvents.map((event) => event.action)).toContain('rollback');
  });

  it('blocks promotion until holdout metrics cover the required fixture set', async () => {
    const version = await service.proposeVersion({
      skill: 'judge',
      promptVersion: 'formula-judge-v2',
      rubricVersion: 'formula-judge-rubric-v2',
      promptBody: 'Judge formula output.',
      rubricBody: 'Prefer concise decisions.',
    });
    await service.approveVersion({
      skill: 'judge',
      versionId: version.id,
    });

    await expect(
      service.promoteVersion({
        skill: 'judge',
        versionId: version.id,
      }),
    ).rejects.toThrow(/requires holdout metrics/);
  });

  it('attaches Claude feedback to the active target skill version', async () => {
    const feedback = await service.recordJudgeFeedback({
      sourcePack: {
        sourcePackId: 'pack-1',
        htsNumber: '6109.10.00.12',
        sourceVersion: 'fixture',
        effectiveDate: '2026-01-01',
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
      },
      judgeRun: {
        agentRole: 'claude_judge',
        modelId: 'claude',
        promptVersion: 'formula-judge-v1',
        promptHash: 'hash',
        rawOutput: '{}',
        sanitizedOutput: '{}',
        validationErrors: [],
        latencyMs: 1,
        status: 'parsed',
        metadata: {},
        parsedArtifact: {
          judgeVerdict: 'both_equivalent',
          selectedArtifact: null,
          corrections: [],
          citationsUsed: [],
          riskLevel: 'P2',
          humanReviewRequired: true,
          skillFeedback: [
            {
              targetSkill: 'extractor',
              message: 'Add a stronger compound-duty example.',
            },
          ],
        },
      },
    });

    expect(feedback[0]).toEqual(
      expect.objectContaining({
        targetSkill: 'extractor',
        targetVersionId: 'extractor:formula-extractor-v1',
      }),
    );
  });
});
