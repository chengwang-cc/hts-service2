import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { HtsEntity } from '../../../core/entities/hts.entity';
import type {
  FormulaAgentRunResult,
  FormulaJudgeRunResult,
} from './formula-llm-runner.service';
import {
  CodexFormulaExtractorService,
  ClaudeFormulaJudgeService,
  QwenFormulaExtractorService,
} from './formula-llm-runner.service';
import type {
  FormulaExtractorOutput,
  FormulaSourcePack,
  JsonRecord,
} from './formula-ai-validation.schemas';
import { formulaAiSourcePackFixtures } from './formula-ai-source-pack.fixtures';
import {
  FormulaLlmComparisonResult,
  FormulaLlmComparisonService,
} from './formula-llm-comparison.service';
import { FormulaSourcePackService } from './formula-source-pack.service';
import { FormulaAiEvidenceService } from './formula-ai-evidence.service';
import { toJsonRecord } from './formula-ai-validation.util';

export type FormulaAiRolloutMode = 'ten_formula_dry_run' | 'chapter';

export interface FormulaAiRolloutInput {
  mode?: FormulaAiRolloutMode;
  htsNumbers?: string[];
  chapter?: string | null;
  limit?: number;
  sourceVersion?: string | null;
  originCountry?: string | null;
  destinationCountry?: string | null;
  runAgents?: boolean;
  judge?: boolean;
  useFixtures?: boolean;
  autoCreatePendingEvidence?: boolean;
  triggeredBy?: string | null;
}

export interface FormulaAiRolloutPolicy {
  killSwitchActive: boolean;
  humanReviewRequired: boolean;
  humanReviewRequiredUntil: string | null;
  autoPendingLowRiskEnabled: boolean;
  acceptanceEnabled: boolean;
  rollbackCriteria: string[];
}

export interface FormulaAiRolloutItem {
  htsNumber: string;
  sourcePackId: string | null;
  status:
    | 'source_pack_failed'
    | 'dry_run_ready'
    | 'compared'
    | 'auto_pending_created'
    | 'blocked'
    | 'failed';
  riskReasons: string[];
  deterministicParserComparison: JsonRecord;
  currentCardComparison: JsonRecord;
  qwen: FormulaAgentRunResult | null;
  codex: FormulaAgentRunResult | null;
  comparison: FormulaLlmComparisonResult | null;
  judge: FormulaJudgeRunResult | null;
  autoPendingEvidence: JsonRecord | null;
  errors: string[];
}

export interface FormulaAiRolloutRun {
  runId: string;
  mode: FormulaAiRolloutMode;
  dryRun: true;
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'blocked';
  policy: FormulaAiRolloutPolicy;
  summary: {
    scanned: number;
    compared: number;
    sourcePackFailed: number;
    matchedOrEquivalent: number;
    different: number;
    judgeRequired: number;
    humanReviewRequired: number;
    autoPendingCreated: number;
    failed: number;
  };
  items: FormulaAiRolloutItem[];
  artifactPath: string;
  metadata: JsonRecord;
}

interface RolloutTarget {
  htsNumber: string;
  sourcePack: FormulaSourcePack | null;
  error: string | null;
}

@Injectable()
export class FormulaAiRolloutService {
  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepo: Repository<HtsEntity>,
    private readonly sourcePacks: FormulaSourcePackService,
    private readonly qwenExtractor: QwenFormulaExtractorService,
    private readonly codexExtractor: CodexFormulaExtractorService,
    private readonly comparison: FormulaLlmComparisonService,
    private readonly claudeJudge: ClaudeFormulaJudgeService,
    private readonly evidence: FormulaAiEvidenceService,
  ) {}

  policy(now = new Date()): FormulaAiRolloutPolicy {
    const requiredUntil = this.humanReviewRequiredUntil();
    const firstMonthStillActive = requiredUntil
      ? now.getTime() < new Date(requiredUntil).getTime()
      : false;
    const humanReviewRequired =
      process.env.FORMULA_AI_HUMAN_REVIEW_REQUIRED !== 'false' ||
      firstMonthStillActive;
    return {
      killSwitchActive: process.env.FORMULA_AI_KILL_SWITCH === 'true',
      humanReviewRequired,
      humanReviewRequiredUntil: requiredUntil,
      autoPendingLowRiskEnabled:
        process.env.FORMULA_AI_AUTO_PENDING_LOW_RISK === 'true' &&
        !humanReviewRequired,
      acceptanceEnabled: process.env.FORMULA_AI_ACCEPTANCE_ENABLED !== 'false',
      rollbackCriteria: [
        'Any P1 formula discrepancy against deterministic parser or current card',
        'Any high-risk Chapter 99, quota, range, unit conversion, or note-derived formula without human approval',
        'Any valid JSON rate below 95% in holdout or dry-run batches',
        'Any accepted artifact without source pack, citation, and regression vector',
      ],
    };
  }

  async run(input: FormulaAiRolloutInput = {}): Promise<FormulaAiRolloutRun> {
    const mode = input.mode || (input.chapter ? 'chapter' : 'ten_formula_dry_run');
    const limit = Math.min(Math.max(input.limit ?? (mode === 'chapter' ? 50 : 10), 1), 250);
    const policy = this.policy();
    if (
      policy.killSwitchActive &&
      (input.runAgents || input.autoCreatePendingEvidence)
    ) {
      throw new BadRequestException(
        'Formula AI rollout kill switch is active; agent and auto-pending runs are blocked',
      );
    }

    const startedAt = new Date().toISOString();
    const runId = this.runId(mode);
    const targets = await this.resolveTargets({
      ...input,
      mode,
      limit,
    });
    const items: FormulaAiRolloutItem[] = [];
    for (const target of targets) {
      items.push(await this.processTarget(target, input, policy));
    }
    const artifactPath = this.runPath(runId);
    const run: FormulaAiRolloutRun = {
      runId,
      mode,
      dryRun: true,
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'completed',
      policy,
      summary: this.summary(items),
      items,
      artifactPath,
      metadata: toJsonRecord({
        source: 'formula-ai-rollout-service',
        triggeredBy: input.triggeredBy || 'admin-ui',
        runAgents: !!input.runAgents,
        judge: !!input.judge,
        useFixtures: !!input.useFixtures,
        chapter: input.chapter || null,
      }),
    };
    await this.writeRun(run);
    return run;
  }

  async latestRun(): Promise<FormulaAiRolloutRun | null> {
    try {
      const files = (await readdir(this.rolloutDir()))
        .filter((file) => file.startsWith('rollout-') && file.endsWith('.json'))
        .sort();
      const latest = files.at(-1);
      if (!latest) {
        return null;
      }
      return JSON.parse(
        await readFile(join(this.rolloutDir(), latest), 'utf8'),
      ) as FormulaAiRolloutRun;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
  }

  private async processTarget(
    target: RolloutTarget,
    input: FormulaAiRolloutInput,
    policy: FormulaAiRolloutPolicy,
  ): Promise<FormulaAiRolloutItem> {
    if (!target.sourcePack) {
      return this.emptyItem(target.htsNumber, 'source_pack_failed', [
        target.error || 'Source pack unavailable',
      ]);
    }
    const sourcePack = target.sourcePack;
    const base = this.emptyItem(sourcePack.htsNumber, 'dry_run_ready', []);
    base.sourcePackId = sourcePack.sourcePackId;
    base.riskReasons = this.localRiskReasons(sourcePack);
    base.deterministicParserComparison = this.deterministicParserComparison(sourcePack);
    base.currentCardComparison = this.currentCardComparison(sourcePack, null);

    if (!input.runAgents) {
      return base;
    }

    try {
      const [qwen, codex] = await Promise.all([
        this.qwenExtractor.extract(sourcePack),
        this.codexExtractor.extract(sourcePack),
      ]);
      const comparison = this.comparison.compare({
        sourcePack,
        codexOutput: codex.parsedArtifact,
        qwenOutput: qwen.parsedArtifact,
        codexErrors: codex.validationErrors,
        qwenErrors: qwen.validationErrors,
      });
      const parserDisagrees = this.comparison.parserDisagreesWithSelected(
        sourcePack,
        comparison.selectedArtifact,
      );
      const judge =
        input.judge && (comparison.requiresClaudeJudge || parserDisagrees)
          ? await this.claudeJudge.judge({
              sourcePack,
              codexOutput: codex.parsedArtifact,
              qwenOutput: qwen.parsedArtifact,
              comparison: toJsonRecord(comparison),
              deterministicParserOutput: sourcePack.knownParserOutput,
              evidence: toJsonRecord({
                knownEvidence: sourcePack.knownEvidence,
                knownCards: sourcePack.knownCards,
              }),
              highRisk: comparison.highRiskReasons.length > 0 || parserDisagrees,
            })
          : null;
      const selectedArtifact = comparison.selectedArtifact;
      const item: FormulaAiRolloutItem = {
        ...base,
        status: 'compared',
        riskReasons: [...new Set([...base.riskReasons, ...comparison.highRiskReasons])],
        qwen,
        codex,
        comparison,
        judge,
        deterministicParserComparison: this.deterministicParserComparison(
          sourcePack,
          selectedArtifact,
        ),
        currentCardComparison: this.currentCardComparison(
          sourcePack,
          selectedArtifact,
        ),
      };

      if (
        input.autoCreatePendingEvidence &&
        selectedArtifact &&
        this.canAutoCreatePendingEvidence({
          artifact: selectedArtifact,
          comparison,
          policy,
          riskReasons: item.riskReasons,
        })
      ) {
        const result = await this.evidence.acceptArtifact({
          sourcePack,
          artifact: selectedArtifact,
          reviewer: 'formula-ai-rollout-auto-pending',
          aiPromptVersion: 'formula-extractor-v1',
          createRegressionTests: true,
          enqueueRecompute: true,
        });
        item.status = 'auto_pending_created';
        item.autoPendingEvidence = toJsonRecord(result);
      }
      return item;
    } catch (error) {
      return {
        ...base,
        status: 'failed',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private canAutoCreatePendingEvidence(args: {
    artifact: FormulaExtractorOutput;
    comparison: FormulaLlmComparisonResult;
    policy: FormulaAiRolloutPolicy;
    riskReasons: string[];
  }): boolean {
    if (!args.policy.acceptanceEnabled || !args.policy.autoPendingLowRiskEnabled) {
      return false;
    }
    if (args.policy.humanReviewRequired || args.riskReasons.length > 0) {
      return false;
    }
    if (
      args.comparison.agreementStatus !== 'matched' &&
      args.comparison.agreementStatus !== 'equivalent'
    ) {
      return false;
    }
    if (args.artifact.needsJudge || args.artifact.components.length === 0) {
      return false;
    }
    return (
      args.artifact.verdict === 'no_duty' ||
      args.artifact.components.every((component) =>
        String(component.sourceRateText || '').includes('%'),
      )
    );
  }

  private async resolveTargets(
    input: FormulaAiRolloutInput & { mode: FormulaAiRolloutMode; limit: number },
  ): Promise<RolloutTarget[]> {
    if (input.useFixtures) {
      return formulaAiSourcePackFixtures
        .slice(0, input.limit)
        .map((fixture) => ({
          htsNumber: fixture.sourcePack.htsNumber,
          sourcePack: fixture.sourcePack,
          error: null,
        }));
    }

    const htsNumbers =
      input.htsNumbers && input.htsNumbers.length > 0
        ? input.htsNumbers
        : await this.loadHtsNumbers(input);
    if (htsNumbers.length === 0) {
      return formulaAiSourcePackFixtures
        .slice(0, input.limit)
        .map((fixture) => ({
          htsNumber: fixture.sourcePack.htsNumber,
          sourcePack: fixture.sourcePack,
          error: null,
        }));
    }

    const targets: RolloutTarget[] = [];
    for (const htsNumber of htsNumbers.slice(0, input.limit)) {
      try {
        targets.push({
          htsNumber,
          sourcePack: await this.sourcePacks.build({
            htsNumber,
            sourceVersion: input.sourceVersion || undefined,
            originCountry: input.originCountry || undefined,
            destinationCountry: input.destinationCountry || undefined,
          }),
          error: null,
        });
      } catch (error) {
        targets.push({
          htsNumber,
          sourcePack: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return targets;
  }

  private async loadHtsNumbers(
    input: FormulaAiRolloutInput & { mode: FormulaAiRolloutMode; limit: number },
  ): Promise<string[]> {
    const qb = this.htsRepo
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .where('hts.isActive = :isActive', { isActive: true })
      .andWhere(
        '(hts.generalRate IS NOT NULL OR hts.general IS NOT NULL OR hts.rateFormula IS NOT NULL OR hts.chapter99 IS NOT NULL)',
      );
    if (input.mode === 'chapter') {
      if (!input.chapter) {
        throw new BadRequestException('chapter is required for chapter rollout');
      }
      if (!/^\d{1,2}$/.test(input.chapter)) {
        throw new BadRequestException('chapter must be a 1 or 2 digit number');
      }
      qb.andWhere('hts.chapter = :chapter', {
        chapter: input.chapter.padStart(2, '0'),
      });
    }
    if (input.sourceVersion) {
      qb.andWhere(
        '(hts.sourceVersion = :sourceVersion OR hts.version = :sourceVersion)',
        { sourceVersion: input.sourceVersion },
      );
    }
    const rows = await qb
      .orderBy('hts.importDate', 'DESC', 'NULLS LAST')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(input.limit)
      .getRawMany<{ htsNumber: string }>();
    return rows.map((row) => row.htsNumber);
  }

  private emptyItem(
    htsNumber: string,
    status: FormulaAiRolloutItem['status'],
    errors: string[],
  ): FormulaAiRolloutItem {
    return {
      htsNumber,
      sourcePackId: null,
      status,
      riskReasons: [],
      deterministicParserComparison: {},
      currentCardComparison: {},
      qwen: null,
      codex: null,
      comparison: null,
      judge: null,
      autoPendingEvidence: null,
      errors,
    };
  }

  private deterministicParserComparison(
    sourcePack: FormulaSourcePack,
    selectedArtifact: FormulaExtractorOutput | null = null,
  ): JsonRecord {
    const parser = sourcePack.knownParserOutput;
    const parserFormula =
      parser.formulaText || parser.formula || parser.rateFormula || null;
    const selectedFormulas =
      selectedArtifact?.components
        .map((component) => component.formulaText)
        .filter((value): value is string => typeof value === 'string' && !!value) || [];
    const exactMatch =
      typeof parserFormula === 'string' && selectedFormulas.includes(parserFormula);
    return toJsonRecord({
      parserAvailable: Object.keys(parser).length > 0,
      parserFormula,
      selectedFormulas,
      sourceRateText: sourcePack.rateText,
      status: !parserFormula
        ? 'parser_formula_missing'
        : selectedFormulas.length === 0
          ? 'no_selected_artifact'
          : exactMatch
            ? 'matches_deterministic_parser'
            : 'differs_from_deterministic_parser',
    });
  }

  private currentCardComparison(
    sourcePack: FormulaSourcePack,
    selectedArtifact: FormulaExtractorOutput | null,
  ): JsonRecord {
    const currentFormulas = sourcePack.knownCards
      .map((card) => card.consensusFormula)
      .filter((value): value is string => typeof value === 'string' && !!value);
    const selectedFormulas =
      selectedArtifact?.components
        .map((component) => component.formulaText)
        .filter((value): value is string => typeof value === 'string' && !!value) || [];
    const overlap = selectedFormulas.filter((formula) =>
      currentFormulas.includes(formula),
    );
    return toJsonRecord({
      currentCardCount: sourcePack.knownCards.length,
      currentFormulaCount: currentFormulas.length,
      selectedFormulaCount: selectedFormulas.length,
      overlap,
      status:
        currentFormulas.length === 0
          ? 'no_current_card_formula'
          : selectedFormulas.length === 0
            ? 'no_selected_artifact'
            : overlap.length > 0
              ? 'matches_current_card'
              : 'differs_from_current_card',
    });
  }

  private localRiskReasons(sourcePack: FormulaSourcePack): string[] {
    const reasons = new Set<string>();
    const text = [
      sourcePack.rateText,
      sourcePack.specialRateText,
      sourcePack.otherRateText,
      sourcePack.chapter99Text,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (sourcePack.htsNumber.startsWith('99') || sourcePack.chapter99Candidates.length > 0) {
      reasons.add('chapter_99');
    }
    if (text.includes('quota')) reasons.add('quota');
    if (/\b(minimum|maximum|min|max|not less than|not more than)\b/.test(text)) {
      reasons.add('min_max_constraint');
    }
    if (sourcePack.chapterNotes.length > 0 || sourcePack.generalNotes.length > 0) {
      reasons.add('note_derived');
    }
    if (/[0-9]\s*(kg|liter|litre|m2|doz|pair|prs|proof)/i.test(text)) {
      reasons.add('unit_conversion');
    }
    return [...reasons];
  }

  private summary(items: FormulaAiRolloutItem[]): FormulaAiRolloutRun['summary'] {
    return {
      scanned: items.length,
      compared: items.filter((item) => !!item.comparison).length,
      sourcePackFailed: items.filter((item) => item.status === 'source_pack_failed').length,
      matchedOrEquivalent: items.filter(
        (item) =>
          item.comparison?.agreementStatus === 'matched' ||
          item.comparison?.agreementStatus === 'equivalent',
      ).length,
      different: items.filter((item) => item.comparison?.agreementStatus === 'different').length,
      judgeRequired: items.filter((item) => item.comparison?.requiresClaudeJudge).length,
      humanReviewRequired: items.filter(
        (item) =>
          item.comparison?.requiresHumanReview ||
          item.riskReasons.length > 0 ||
          item.status === 'source_pack_failed',
      ).length,
      autoPendingCreated: items.filter((item) => item.status === 'auto_pending_created').length,
      failed: items.filter((item) => item.status === 'failed').length,
    };
  }

  private humanReviewRequiredUntil(): string | null {
    if (process.env.FORMULA_AI_HUMAN_REVIEW_REQUIRED_UNTIL) {
      return process.env.FORMULA_AI_HUMAN_REVIEW_REQUIRED_UNTIL;
    }
    if (!process.env.FORMULA_AI_ROLLOUT_STARTED_AT) {
      return null;
    }
    const startedAt = new Date(process.env.FORMULA_AI_ROLLOUT_STARTED_AT);
    if (!Number.isFinite(startedAt.getTime())) {
      return null;
    }
    startedAt.setUTCDate(startedAt.getUTCDate() + 30);
    return startedAt.toISOString();
  }

  private async writeRun(run: FormulaAiRolloutRun): Promise<void> {
    await mkdir(this.rolloutDir(), { recursive: true });
    await writeFile(run.artifactPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  }

  private rolloutDir(): string {
    return (
      process.env.FORMULA_AI_ROLLOUT_DIR ||
      join(process.cwd(), 'var', 'formula-ai', 'rollouts')
    );
  }

  private runPath(runId: string): string {
    return join(this.rolloutDir(), `${runId}.json`);
  }

  private runId(mode: FormulaAiRolloutMode): string {
    return `rollout-${new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')}-${mode}-${randomUUID().slice(0, 8)}`;
  }
}
