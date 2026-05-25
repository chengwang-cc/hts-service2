import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import type {
  FormulaJudgeOutput,
  FormulaSourcePack,
  JsonRecord,
} from './formula-ai-validation.schemas';
import { formulaAiSourcePackFixtures } from './formula-ai-source-pack.fixtures';
import {
  sha256Hex,
  stableStringify,
  toJsonRecord,
} from './formula-ai-validation.util';
import type { FormulaJudgeRunResult } from './formula-llm-runner.service';

export type FormulaAiSkillName = 'extractor' | 'judge';
export type FormulaAiSkillVersionStatus =
  | 'draft'
  | 'approved'
  | 'promoted'
  | 'rolled_back'
  | 'retired';
export type FormulaAiSkillFeedbackSource =
  | 'claude'
  | 'human'
  | 'holdout'
  | 'system';

export interface FormulaAiSkillVersion {
  id: string;
  skill: FormulaAiSkillName;
  promptVersion: string;
  rubricVersion: string;
  promptHash: string;
  rubricHash: string;
  status: FormulaAiSkillVersionStatus;
  createdAt: string;
  createdBy: string;
  changeSummary: string;
  approvedAt: string | null;
  approvedBy: string | null;
  promotedAt: string | null;
  promotedBy: string | null;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  holdoutMetrics: FormulaAiHoldoutMetrics | null;
  metadata: JsonRecord;
}

export interface FormulaAiSkillFeedback {
  id: string;
  createdAt: string;
  source: FormulaAiSkillFeedbackSource;
  targetSkill: FormulaAiSkillName;
  targetVersionId: string;
  reviewer: string;
  severity: 'P1' | 'P2' | 'P3';
  message: string;
  runId: string | null;
  sourcePackId: string | null;
  metadata: JsonRecord;
}

export interface FormulaAiHoldoutMetrics {
  fixtureCount: number;
  passed: number;
  failed: number;
  score: number;
  promptHash: string;
  rubricHash: string;
  evaluatedAt: string;
}

export interface FormulaAiHoldoutRun {
  id: string;
  skill: FormulaAiSkillName;
  versionId: string;
  status: 'completed';
  startedAt: string;
  completedAt: string;
  metrics: FormulaAiHoldoutMetrics;
  fixtureResults: Array<{
    fixtureKey: string;
    htsNumber: string;
    passed: boolean;
    expectedRouting: 'auto_candidate' | 'human_review';
    checks: string[];
  }>;
  metadata: JsonRecord;
}

export interface FormulaAiSkillPromotionEvent {
  id: string;
  createdAt: string;
  action: 'approve' | 'promote' | 'rollback';
  skill: FormulaAiSkillName;
  fromVersionId: string | null;
  toVersionId: string;
  actor: string;
  note: string | null;
}

export interface FormulaAiSkillRegistrySnapshot {
  schemaVersion: 'formula-ai-skill-registry-v1';
  updatedAt: string;
  activeVersions: Record<FormulaAiSkillName, string>;
  versions: FormulaAiSkillVersion[];
  feedback: FormulaAiSkillFeedback[];
  holdoutRuns: FormulaAiHoldoutRun[];
  promotionEvents: FormulaAiSkillPromotionEvent[];
}

export interface ProposeFormulaAiSkillVersionInput {
  skill: FormulaAiSkillName;
  promptVersion: string;
  rubricVersion: string;
  promptBody?: string | null;
  rubricBody?: string | null;
  createdBy?: string | null;
  changeSummary?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RecordFormulaAiSkillFeedbackInput {
  source: FormulaAiSkillFeedbackSource;
  targetSkill: FormulaAiSkillName;
  targetVersionId?: string | null;
  reviewer?: string | null;
  severity?: 'P1' | 'P2' | 'P3' | null;
  message: string;
  runId?: string | null;
  sourcePackId?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class FormulaAiSkillRegistryService {
  private readonly maxFeedbackRecords = 1000;

  async snapshot(): Promise<FormulaAiSkillRegistrySnapshot> {
    const registry = await this.readRegistry();
    return this.sorted(registry);
  }

  async proposeVersion(
    input: ProposeFormulaAiSkillVersionInput,
  ): Promise<FormulaAiSkillVersion> {
    this.assertSkillName(input.skill);
    const registry = await this.readRegistry();
    if (registry.versions.some((version) => version.id === this.versionId(input))) {
      throw new BadRequestException(`Skill version already exists: ${this.versionId(input)}`);
    }
    const now = new Date().toISOString();
    const promptBody = input.promptBody || this.defaultPromptBody(input.skill);
    const rubricBody = input.rubricBody || this.defaultRubricBody(input.skill);
    const version: FormulaAiSkillVersion = {
      id: this.versionId(input),
      skill: input.skill,
      promptVersion: input.promptVersion,
      rubricVersion: input.rubricVersion,
      promptHash: sha256Hex(promptBody),
      rubricHash: sha256Hex(rubricBody),
      status: 'draft',
      createdAt: now,
      createdBy: input.createdBy || 'admin-ui',
      changeSummary: input.changeSummary || 'Formula AI skill version proposal',
      approvedAt: null,
      approvedBy: null,
      promotedAt: null,
      promotedBy: null,
      rolledBackAt: null,
      rolledBackBy: null,
      holdoutMetrics: null,
      metadata: toJsonRecord({
        ...(input.metadata || {}),
        promptBody,
        rubricBody,
      }),
    };
    registry.versions.push(version);
    await this.writeRegistry(registry);
    return version;
  }

  async recordFeedback(
    input: RecordFormulaAiSkillFeedbackInput,
  ): Promise<FormulaAiSkillFeedback> {
    this.assertSkillName(input.targetSkill);
    if (!input.message.trim()) {
      throw new BadRequestException('Feedback message is required');
    }
    const registry = await this.readRegistry();
    const targetVersionId =
      input.targetVersionId || registry.activeVersions[input.targetSkill];
    this.findVersion(registry, input.targetSkill, targetVersionId);
    const feedback: FormulaAiSkillFeedback = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      source: input.source,
      targetSkill: input.targetSkill,
      targetVersionId,
      reviewer: input.reviewer || input.source,
      severity: input.severity || 'P3',
      message: input.message.trim(),
      runId: input.runId || null,
      sourcePackId: input.sourcePackId || null,
      metadata: toJsonRecord(input.metadata || {}),
    };
    registry.feedback.unshift(feedback);
    registry.feedback = registry.feedback.slice(0, this.maxFeedbackRecords);
    await this.writeRegistry(registry);
    return feedback;
  }

  async recordJudgeFeedback(args: {
    sourcePack: FormulaSourcePack;
    judgeRun: FormulaJudgeRunResult | null;
    runId?: string | null;
  }): Promise<FormulaAiSkillFeedback[]> {
    const judgeOutput = args.judgeRun?.parsedArtifact;
    if (!judgeOutput || judgeOutput.skillFeedback.length === 0) {
      return [];
    }
    const feedback: FormulaAiSkillFeedback[] = [];
    for (const item of judgeOutput.skillFeedback) {
      const targetSkill = this.skillFromFeedback(item);
      feedback.push(
        await this.recordFeedback({
          source: 'claude',
          targetSkill,
          targetVersionId: targetSkill === 'judge' && args.judgeRun?.promptVersion
            ? `judge:${args.judgeRun.promptVersion}`
            : null,
          reviewer: args.judgeRun?.modelId || 'claude',
          severity: this.severityFromJudge(judgeOutput, item),
          message: this.messageFromFeedback(item),
          runId: args.runId || null,
          sourcePackId: args.sourcePack.sourcePackId,
          metadata: {
            judgeVerdict: judgeOutput.judgeVerdict,
            riskLevel: judgeOutput.riskLevel,
            item,
          },
        }),
      );
    }
    return feedback;
  }

  async approveVersion(args: {
    skill: FormulaAiSkillName;
    versionId: string;
    actor?: string | null;
    note?: string | null;
  }): Promise<FormulaAiSkillVersion> {
    this.assertSkillName(args.skill);
    return this.transitionVersion({
      ...args,
      action: 'approve',
      nextStatus: 'approved',
    });
  }

  async promoteVersion(args: {
    skill: FormulaAiSkillName;
    versionId: string;
    actor?: string | null;
    note?: string | null;
  }): Promise<FormulaAiSkillVersion> {
    this.assertSkillName(args.skill);
    const registry = await this.readRegistry();
    const version = this.findVersion(registry, args.skill, args.versionId);
    if (version.status !== 'approved' && version.status !== 'promoted') {
      throw new BadRequestException('Only approved skill versions can be promoted');
    }
    this.assertPromotionMetrics(version);
    const previous = registry.activeVersions[args.skill] || null;
    for (const candidate of registry.versions) {
      if (candidate.skill === args.skill && candidate.status === 'promoted') {
        candidate.status = 'approved';
      }
    }
    version.status = 'promoted';
    version.promotedAt = new Date().toISOString();
    version.promotedBy = args.actor || 'admin-ui';
    registry.activeVersions[args.skill] = version.id;
    registry.promotionEvents.unshift(
      this.promotionEvent({
        action: 'promote',
        skill: args.skill,
        fromVersionId: previous,
        toVersionId: version.id,
        actor: args.actor,
        note: args.note,
      }),
    );
    await this.writeRegistry(registry);
    return version;
  }

  async rollbackVersion(args: {
    skill: FormulaAiSkillName;
    targetVersionId?: string | null;
    actor?: string | null;
    note?: string | null;
  }): Promise<FormulaAiSkillVersion> {
    this.assertSkillName(args.skill);
    const registry = await this.readRegistry();
    const previous = registry.activeVersions[args.skill] || null;
    const targetVersionId =
      args.targetVersionId || this.previousPromotableVersion(registry, args.skill, previous);
    const version = this.findVersion(registry, args.skill, targetVersionId);
    for (const candidate of registry.versions) {
      if (candidate.skill === args.skill && candidate.status === 'promoted') {
        candidate.status = 'rolled_back';
        candidate.rolledBackAt = new Date().toISOString();
        candidate.rolledBackBy = args.actor || 'admin-ui';
      }
    }
    version.status = 'promoted';
    version.promotedAt = new Date().toISOString();
    version.promotedBy = args.actor || 'admin-ui';
    registry.activeVersions[args.skill] = version.id;
    registry.promotionEvents.unshift(
      this.promotionEvent({
        action: 'rollback',
        skill: args.skill,
        fromVersionId: previous,
        toVersionId: version.id,
        actor: args.actor,
        note: args.note,
      }),
    );
    await this.writeRegistry(registry);
    return version;
  }

  async runHoldoutEvaluation(args: {
    skill: FormulaAiSkillName;
    versionId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<FormulaAiHoldoutRun> {
    this.assertSkillName(args.skill);
    const registry = await this.readRegistry();
    const versionId = args.versionId || registry.activeVersions[args.skill];
    const version = this.findVersion(registry, args.skill, versionId);
    const startedAt = new Date().toISOString();
    const skillText = this.versionText(version);
    const fixtureResults = formulaAiSourcePackFixtures.map((fixture) =>
      this.evaluateFixture(
        args.skill,
        fixture.fixtureKey,
        fixture.sourcePack,
        skillText,
      ),
    );
    const passed = fixtureResults.filter((result) => result.passed).length;
    const metrics: FormulaAiHoldoutMetrics = {
      fixtureCount: fixtureResults.length,
      passed,
      failed: fixtureResults.length - passed,
      score: fixtureResults.length ? passed / fixtureResults.length : 0,
      promptHash: version.promptHash,
      rubricHash: version.rubricHash,
      evaluatedAt: new Date().toISOString(),
    };
    const run: FormulaAiHoldoutRun = {
      id: randomUUID(),
      skill: args.skill,
      versionId,
      status: 'completed',
      startedAt,
      completedAt: new Date().toISOString(),
      metrics,
      fixtureResults,
      metadata: toJsonRecord(args.metadata || {}),
    };
    version.holdoutMetrics = metrics;
    registry.holdoutRuns.unshift(run);
    registry.feedback.unshift({
      id: randomUUID(),
      createdAt: run.completedAt,
      source: 'holdout',
      targetSkill: args.skill,
      targetVersionId: versionId,
      reviewer: 'formula-ai-holdout',
      severity: metrics.failed > 0 ? 'P2' : 'P3',
      message: `Holdout evaluation score ${metrics.score.toFixed(3)} (${metrics.passed}/${metrics.fixtureCount})`,
      runId: run.id,
      sourcePackId: null,
      metadata: toJsonRecord(metrics),
    });
    registry.feedback = registry.feedback.slice(0, this.maxFeedbackRecords);
    await this.writeRegistry(registry);
    return run;
  }

  private async readRegistry(): Promise<FormulaAiSkillRegistrySnapshot> {
    try {
      const raw = await readFile(this.registryPath(), 'utf8');
      const parsed = JSON.parse(raw) as FormulaAiSkillRegistrySnapshot;
      return this.withDefaults(parsed);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        const registry = this.defaultRegistry();
        await this.writeRegistry(registry);
        return registry;
      }
      throw error;
    }
  }

  private async writeRegistry(
    registry: FormulaAiSkillRegistrySnapshot,
  ): Promise<void> {
    registry.updatedAt = new Date().toISOString();
    const path = this.registryPath();
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(this.sorted(registry), null, 2)}\n`, 'utf8');
    await rename(tmpPath, path);
  }

  private registryPath(): string {
    return (
      process.env.FORMULA_AI_REGISTRY_PATH ||
      join(process.cwd(), 'var', 'formula-ai', 'skill-registry.json')
    );
  }

  private defaultRegistry(): FormulaAiSkillRegistrySnapshot {
    const now = new Date().toISOString();
    const extractor = this.defaultVersion('extractor', now);
    const judge = this.defaultVersion('judge', now);
    return {
      schemaVersion: 'formula-ai-skill-registry-v1',
      updatedAt: now,
      activeVersions: {
        extractor: extractor.id,
        judge: judge.id,
      },
      versions: [extractor, judge],
      feedback: [],
      holdoutRuns: [],
      promotionEvents: [],
    };
  }

  private withDefaults(
    registry: FormulaAiSkillRegistrySnapshot,
  ): FormulaAiSkillRegistrySnapshot {
    const defaults = this.defaultRegistry();
    const versions = [...registry.versions];
    for (const version of defaults.versions) {
      if (!versions.some((candidate) => candidate.id === version.id)) {
        versions.push(version);
      }
    }
    return {
      ...defaults,
      ...registry,
      activeVersions: {
        ...defaults.activeVersions,
        ...(registry.activeVersions || {}),
      },
      versions,
      feedback: registry.feedback || [],
      holdoutRuns: registry.holdoutRuns || [],
      promotionEvents: registry.promotionEvents || [],
    };
  }

  private defaultVersion(
    skill: FormulaAiSkillName,
    createdAt: string,
  ): FormulaAiSkillVersion {
    const promptVersion =
      skill === 'extractor' ? 'formula-extractor-v1' : 'formula-judge-v1';
    const rubricVersion =
      skill === 'extractor' ? 'formula-extractor-rubric-v1' : 'formula-judge-rubric-v1';
    const promptBody = this.defaultPromptBody(skill);
    const rubricBody = this.defaultRubricBody(skill);
    return {
      id: `${skill}:${promptVersion}`,
      skill,
      promptVersion,
      rubricVersion,
      promptHash: sha256Hex(promptBody),
      rubricHash: sha256Hex(rubricBody),
      status: 'promoted',
      createdAt,
      createdBy: 'system',
      changeSummary: 'Initial Formula AI skill baseline',
      approvedAt: createdAt,
      approvedBy: 'system',
      promotedAt: createdAt,
      promotedBy: 'system',
      rolledBackAt: null,
      rolledBackBy: null,
      holdoutMetrics: null,
      metadata: toJsonRecord({ promptBody, rubricBody }),
    };
  }

  private transitionVersion(args: {
    action: 'approve';
    nextStatus: FormulaAiSkillVersionStatus;
    skill: FormulaAiSkillName;
    versionId: string;
    actor?: string | null;
    note?: string | null;
  }): Promise<FormulaAiSkillVersion> {
    return this.readRegistry().then(async (registry) => {
      const version = this.findVersion(registry, args.skill, args.versionId);
      version.status = args.nextStatus;
      version.approvedAt = new Date().toISOString();
      version.approvedBy = args.actor || 'admin-ui';
      registry.promotionEvents.unshift(
        this.promotionEvent({
          action: args.action,
          skill: args.skill,
          fromVersionId: null,
          toVersionId: version.id,
          actor: args.actor,
          note: args.note,
        }),
      );
      await this.writeRegistry(registry);
      return version;
    });
  }

  private promotionEvent(args: {
    action: FormulaAiSkillPromotionEvent['action'];
    skill: FormulaAiSkillName;
    fromVersionId: string | null;
    toVersionId: string;
    actor?: string | null;
    note?: string | null;
  }): FormulaAiSkillPromotionEvent {
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      action: args.action,
      skill: args.skill,
      fromVersionId: args.fromVersionId,
      toVersionId: args.toVersionId,
      actor: args.actor || 'admin-ui',
      note: args.note || null,
    };
  }

  private findVersion(
    registry: FormulaAiSkillRegistrySnapshot,
    skill: FormulaAiSkillName,
    versionId: string,
  ): FormulaAiSkillVersion {
    const version = registry.versions.find(
      (candidate) => candidate.skill === skill && candidate.id === versionId,
    );
    if (!version) {
      throw new NotFoundException(`Formula AI skill version not found: ${versionId}`);
    }
    return version;
  }

  private previousPromotableVersion(
    registry: FormulaAiSkillRegistrySnapshot,
    skill: FormulaAiSkillName,
    currentVersionId: string | null,
  ): string {
    const previous = registry.versions.find(
      (version) =>
        version.skill === skill &&
        version.id !== currentVersionId &&
        (version.status === 'approved' || version.status === 'rolled_back'),
    );
    if (!previous) {
      throw new NotFoundException(`No rollback target found for ${skill}`);
    }
    return previous.id;
  }

  private evaluateFixture(
    skill: FormulaAiSkillName,
    fixtureKey: string,
    sourcePack: FormulaSourcePack,
    skillText: string,
  ): FormulaAiHoldoutRun['fixtureResults'][number] {
    const humanReviewExpected =
      fixtureKey === 'chapter-99' ||
      fixtureKey === 'ambiguous' ||
      sourcePack.chapter99Candidates.length > 0 ||
      sourcePack.chapterNotes.length > 0;
    const requiredChecks = this.requiredHoldoutChecks(
      skill,
      fixtureKey,
      humanReviewExpected,
    );
    const checks = requiredChecks.map((check) =>
      this.skillTextCovers(skillText, check)
        ? `${check}:pass`
        : `${check}:fail`,
    );
    return {
      fixtureKey,
      htsNumber: sourcePack.htsNumber,
      passed: checks.every((check) => check.endsWith(':pass')),
      expectedRouting: humanReviewExpected ? 'human_review' : 'auto_candidate',
      checks,
    };
  }

  private skillFromFeedback(item: JsonRecord): FormulaAiSkillName {
    const raw = String(item.targetSkill || item.skill || 'judge');
    return raw === 'extractor' ? 'extractor' : 'judge';
  }

  private severityFromJudge(
    judgeOutput: FormulaJudgeOutput,
    item: JsonRecord,
  ): 'P1' | 'P2' | 'P3' {
    const raw = item.severity;
    if (raw === 'P1' || raw === 'P2' || raw === 'P3') {
      return raw;
    }
    return judgeOutput.riskLevel;
  }

  private messageFromFeedback(item: JsonRecord): string {
    for (const key of ['message', 'feedback', 'recommendation', 'reason']) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return stableStringify(item);
  }

  private versionId(input: {
    skill: FormulaAiSkillName;
    promptVersion: string;
  }): string {
    return `${input.skill}:${input.promptVersion}`;
  }

  private defaultPromptBody(skill: FormulaAiSkillName): string {
    return skill === 'extractor'
      ? 'Extract strict FormulaExtractorOutput JSON from immutable HTS source packs with citations, unit dimensions, constraints, rounding policy, and numeric test vectors for free, ad valorem, specific, compound, Chapter 99, quota, and note-derived formulas.'
      : 'Judge extractor disagreement using source packs, deterministic parser output, current cards, citations, and evidence. Select only source-supported artifacts and route insufficient evidence, Chapter 99, quota, note-derived, unit conversion, and high-risk formulas to human review.';
  }

  private defaultRubricBody(skill: FormulaAiSkillName): string {
    return skill === 'extractor'
      ? 'Return JSON only. Reject ambiguity. Cite source fields. Emit test vectors. Route Chapter 99, quota, note-derived, range, min/max, specific unit, and compound rates to human review.'
      : 'Return JSON only. Select only source-supported artifacts. Require human review for insufficient evidence, parser/card conflict, Chapter 99, quota, note-derived, specific unit, compound, or other high-risk formulas.';
  }

  private assertSkillName(skill: unknown): asserts skill is FormulaAiSkillName {
    if (skill !== 'extractor' && skill !== 'judge') {
      throw new BadRequestException('skill must be extractor or judge');
    }
  }

  private assertPromotionMetrics(version: FormulaAiSkillVersion): void {
    const minScore = Number(process.env.FORMULA_AI_PROMOTION_MIN_SCORE || 0.95);
    const minimumFixtureCount = formulaAiSourcePackFixtures.length;
    if (
      !version.holdoutMetrics ||
      version.holdoutMetrics.fixtureCount < minimumFixtureCount ||
      version.holdoutMetrics.score < minScore
    ) {
      throw new BadRequestException(
        `Skill version ${version.id} requires holdout metrics score >= ${minScore} across at least ${minimumFixtureCount} fixtures before promotion`,
      );
    }
  }

  private versionText(version: FormulaAiSkillVersion): string {
    return [
      version.promptVersion,
      version.rubricVersion,
      version.changeSummary,
      version.metadata.promptBody,
      version.metadata.rubricBody,
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase();
  }

  private requiredHoldoutChecks(
    skill: FormulaAiSkillName,
    fixtureKey: string,
    humanReviewExpected: boolean,
  ): string[] {
    const checks =
      skill === 'extractor'
        ? ['json', 'citation', 'test vector']
        : ['source', 'insufficient evidence', 'human review'];
    if (humanReviewExpected) {
      checks.push('human review');
    }
    if (fixtureKey === 'chapter-99') {
      checks.push('chapter 99');
    }
    if (fixtureKey === 'ambiguous') {
      checks.push('note');
    }
    if (fixtureKey === 'specific') {
      checks.push('unit');
    }
    if (fixtureKey === 'compound') {
      checks.push('compound');
    }
    return Array.from(new Set(checks));
  }

  private skillTextCovers(skillText: string, check: string): boolean {
    if (check === 'test vector') {
      return skillText.includes('test vector');
    }
    if (check === 'human review') {
      return skillText.includes('human review');
    }
    if (check === 'chapter 99') {
      return skillText.includes('chapter 99');
    }
    if (check === 'insufficient evidence') {
      return skillText.includes('insufficient evidence');
    }
    return skillText.includes(check);
  }

  private sorted(
    registry: FormulaAiSkillRegistrySnapshot,
  ): FormulaAiSkillRegistrySnapshot {
    return {
      ...registry,
      versions: [...registry.versions].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
      feedback: [...registry.feedback].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
      holdoutRuns: [...registry.holdoutRuns].sort((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      ),
      promotionEvents: [...registry.promotionEvents].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    };
  }
}
