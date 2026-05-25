#!/usr/bin/env ts-node
// Chapter full-check example:
// npm run formula:llm:validate-chapter100 -- --chapter 02
// Runs 100 formula-bearing rows from one chapter through Qwen, Codex, and
// Claude judge by default. Use --judge-required-only to judge only conflicts.

import 'reflect-metadata';
import 'dotenv/config';
import { mkdir, readFile, appendFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { DataSource, Repository } from 'typeorm';
import { WithLengthColumnType } from 'typeorm/driver/types/ColumnTypes';
import { CustomNamingStrategy } from '../src/configs/custom-naming.strategy';
import { HtsEntity, HtsStageEntryEntity } from '../src/core/entities';
import { FormulaSemanticsService } from '../src/modules/calculator/services/formula-semantics.service';
import { TariffEvidenceEntity } from '../src/modules/calculator/entities/tariff-evidence.entity';
import { TariffKnowledgeCardEntity } from '../src/modules/calculator/entities/tariff-knowledge-card.entity';
import { TariffSourceEntity } from '../src/modules/jurisdiction/entities/tariff-source.entity';
import {
  ClaudeFormulaJudgeService,
  CodexFormulaExtractorService,
  FormulaExtractorPromptService,
  FormulaJudgeRunInput,
  QwenFormulaExtractorService,
} from '../src/modules/admin/services/formula-llm-runner.service';
import { FormulaLlmComparisonService } from '../src/modules/admin/services/formula-llm-comparison.service';
import { FormulaSourcePackService } from '../src/modules/admin/services/formula-source-pack.service';
import { FormulaAiRunArtifactService } from '../src/modules/admin/services/formula-ai-run-artifact.service';
import { FormulaAiSkillRegistryService } from '../src/modules/admin/services/formula-ai-skill-registry.service';
import { toJsonRecord } from '../src/modules/admin/services/formula-ai-validation.util';

interface ValidateAllOptions {
  all: boolean;
  chapter100: boolean;
  limit: number;
  offset: number;
  chapter: string | null;
  sourceVersion: string | null;
  originCountry: string;
  destinationCountry: string;
  outputDir: string;
  resume: boolean;
  runAgents: boolean;
  judge: boolean;
  judgeAll: boolean;
  maxJudge: number | null;
  includeEvidence: boolean;
}

interface BatchState {
  runId: string;
  startedAt: string;
  updatedAt: string;
  options: Record<string, string | number | boolean | null>;
  targetCount: number;
  completed: number;
  succeeded: number;
  failed: number;
  judged: number;
  compared: number;
  humanReviewRequired: number;
  different: number;
  matchedOrEquivalent: number;
  skipped: number;
  lastHtsNumber: string | null;
}

interface TargetRow {
  htsNumber: string;
}

function optionValue(name: string): string | null {
  const prefixed = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefixed));
  if (found) {
    return found.slice(prefixed.length);
  }
  const index = process.argv.indexOf(name);
  if (
    index >= 0 &&
    process.argv[index + 1] &&
    !process.argv[index + 1].startsWith('--')
  ) {
    return process.argv[index + 1];
  }
  return null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readOptions(): ValidateAllOptions {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const outputDir =
    optionValue('--output-dir') ||
    process.env.FORMULA_AI_VALIDATE_ALL_DIR ||
    join(process.cwd(), 'var', 'formula-ai', 'all-hts-validation', timestamp);
  const all = hasFlag('--all');
  const chapter100 =
    hasFlag('--chapter-100') || hasFlag('--chapter-full-check');
  const limitOption = optionValue('--limit');
  const limit = all ? 0 : Number(limitOption || (chapter100 ? 100 : 10));
  const maxJudgeOption = optionValue('--max-judge');
  const judgeAll =
    !hasFlag('--judge-required-only') &&
    (chapter100 || hasFlag('--judge-all') || hasFlag('--all-llm'));
  return {
    all,
    chapter100,
    limit,
    offset: Number(optionValue('--offset') || 0),
    chapter: optionValue('--chapter'),
    sourceVersion: optionValue('--source-version'),
    originCountry: (optionValue('--origin-country') || 'ALL').toUpperCase(),
    destinationCountry: (
      optionValue('--destination-country') || 'US'
    ).toUpperCase(),
    outputDir: resolve(outputDir),
    resume: hasFlag('--resume'),
    runAgents: !hasFlag('--no-agents'),
    judge: !hasFlag('--no-judge'),
    judgeAll,
    maxJudge: maxJudgeOption === null ? null : Number(maxJudgeOption),
    includeEvidence: !hasFlag('--no-evidence'),
  };
}

function validateOptions(options: ValidateAllOptions): void {
  if (options.chapter100 && !options.chapter) {
    throw new Error('--chapter is required when using --chapter-100');
  }
  if (!options.all && (!Number.isFinite(options.limit) || options.limit < 1)) {
    throw new Error('--limit must be a positive number');
  }
  if (!Number.isFinite(options.offset) || options.offset < 0) {
    throw new Error('--offset must be a non-negative number');
  }
  if (
    options.maxJudge !== null &&
    (!Number.isFinite(options.maxJudge) || options.maxJudge < 0)
  ) {
    throw new Error('--max-judge must be a non-negative number');
  }
}

async function createDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'hts',
    namingStrategy: new CustomNamingStrategy(),
    entities: [
      HtsEntity,
      HtsStageEntryEntity,
      TariffEvidenceEntity,
      TariffKnowledgeCardEntity,
      TariffSourceEntity,
    ],
    synchronize: false,
    logging: false,
    ssl:
      process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : process.env.NODE_ENV === 'development'
          ? false
          : { rejectUnauthorized: false },
  });
  dataSource.driver.supportedDataTypes.push('vector' as WithLengthColumnType);
  dataSource.driver.withLengthColumnTypes.push(
    'vector' as WithLengthColumnType,
  );
  dataSource.driver.supportedDataTypes.push('tsvector' as WithLengthColumnType);
  dataSource.driver.withLengthColumnTypes.push(
    'tsvector' as WithLengthColumnType,
  );
  await dataSource.initialize();
  return dataSource;
}

async function loadCompleted(resultsPath: string): Promise<Set<string>> {
  try {
    const content = await readFile(resultsPath, 'utf8');
    return new Set(
      content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { htsNumber?: string })
        .map((item) => item.htsNumber)
        .filter((value): value is string => !!value),
    );
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return new Set();
    }
    throw error;
  }
}

async function loadOrCreateState(
  options: ValidateAllOptions,
  targetCount: number,
): Promise<BatchState> {
  const statePath = join(options.outputDir, 'state.json');
  if (options.resume) {
    try {
      return JSON.parse(await readFile(statePath, 'utf8')) as BatchState;
    } catch (error) {
      if (
        !(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      ) {
        throw error;
      }
    }
  }
  return {
    runId: `validate-all-${new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)}`,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    options: {
      all: options.all,
      chapter100: options.chapter100,
      limit: options.limit,
      offset: options.offset,
      chapter: options.chapter,
      sourceVersion: options.sourceVersion,
      originCountry: options.originCountry,
      destinationCountry: options.destinationCountry,
      runAgents: options.runAgents,
      judge: options.judge,
      judgeAll: options.judgeAll,
      maxJudge: options.maxJudge,
      includeEvidence: options.includeEvidence,
    },
    targetCount,
    completed: 0,
    succeeded: 0,
    failed: 0,
    judged: 0,
    compared: 0,
    humanReviewRequired: 0,
    different: 0,
    matchedOrEquivalent: 0,
    skipped: 0,
    lastHtsNumber: null,
  };
}

async function targetRows(
  htsRepo: Repository<HtsEntity>,
  options: ValidateAllOptions,
): Promise<TargetRow[]> {
  const qb = htsRepo
    .createQueryBuilder('hts')
    .select('hts.htsNumber', 'htsNumber')
    .where('hts.isActive = :isActive', { isActive: true })
    .andWhere(
      '(hts.generalRate IS NOT NULL OR hts.general IS NOT NULL OR hts.rateFormula IS NOT NULL OR hts.chapter99 IS NOT NULL)',
    );
  if (options.chapter) {
    qb.andWhere('hts.chapter = :chapter', {
      chapter: options.chapter.padStart(2, '0'),
    });
  }
  if (options.sourceVersion) {
    qb.andWhere(
      '(hts.sourceVersion = :sourceVersion OR hts.version = :sourceVersion)',
      { sourceVersion: options.sourceVersion },
    );
  }
  qb.orderBy('hts.importDate', 'DESC', 'NULLS LAST').addOrderBy(
    'hts.htsNumber',
    'ASC',
  );
  if (options.offset > 0) {
    qb.offset(options.offset);
  }
  if (!options.all) {
    qb.limit(Math.max(options.limit, 1));
  }
  return qb.getRawMany<TargetRow>();
}

async function main(): Promise<void> {
  const options = readOptions();
  validateOptions(options);
  await mkdir(options.outputDir, { recursive: true });
  process.env.FORMULA_AI_COUNCIL_RUN_DIR =
    process.env.FORMULA_AI_COUNCIL_RUN_DIR ||
    join(options.outputDir, 'council-runs');
  process.env.FORMULA_AI_REGISTRY_PATH =
    process.env.FORMULA_AI_REGISTRY_PATH ||
    join(options.outputDir, 'skill-registry.json');

  const dataSource = await createDataSource();
  try {
    const htsRepo = dataSource.getRepository(HtsEntity);
    const rows = await targetRows(htsRepo, options);
    const resultsPath = join(options.outputDir, 'results.jsonl');
    const completed = options.resume
      ? await loadCompleted(resultsPath)
      : new Set<string>();
    const state = await loadOrCreateState(options, rows.length);
    state.targetCount = rows.length;

    const prompts = new FormulaExtractorPromptService();
    const sourcePacks = new FormulaSourcePackService(
      htsRepo,
      dataSource.getRepository(HtsStageEntryEntity),
      dataSource.getRepository(TariffEvidenceEntity),
      dataSource.getRepository(TariffKnowledgeCardEntity),
    );
    const qwen = new QwenFormulaExtractorService(prompts);
    const codex = new CodexFormulaExtractorService(prompts);
    const judge = new ClaudeFormulaJudgeService(prompts);
    const comparison = new FormulaLlmComparisonService(
      new FormulaSemanticsService(),
      { createPacketForScope: async () => null },
    );
    const artifacts = new FormulaAiRunArtifactService(prompts);
    const skillRegistry = new FormulaAiSkillRegistryService();

    for (const row of rows) {
      if (completed.has(row.htsNumber)) {
        state.skipped++;
        continue;
      }
      const startedAt = new Date().toISOString();
      try {
        const sourcePack = await sourcePacks.build({
          htsNumber: row.htsNumber,
          sourceVersion: options.sourceVersion || undefined,
          originCountry: options.originCountry,
          destinationCountry: options.destinationCountry,
          includeEvidence: options.includeEvidence,
        });
        if (!options.runAgents) {
          await appendFile(
            resultsPath,
            `${JSON.stringify({
              htsNumber: row.htsNumber,
              sourcePackId: sourcePack.sourcePackId,
              status: 'source_pack_ready',
              startedAt,
              completedAt: new Date().toISOString(),
            })}\n`,
            'utf8',
          );
          state.succeeded++;
          state.completed++;
          state.lastHtsNumber = row.htsNumber;
          await writeState(options.outputDir, state);
          continue;
        }

        const [qwenRun, codexRun] = await Promise.all([
          qwen.extract(sourcePack),
          codex.extract(sourcePack),
        ]);
        const comparisonResult = comparison.compare({
          sourcePack,
          qwenOutput: qwenRun.parsedArtifact,
          codexOutput: codexRun.parsedArtifact,
          qwenErrors: qwenRun.validationErrors,
          codexErrors: codexRun.validationErrors,
        });
        const parserDisagrees = comparison.parserDisagreesWithSelected(
          sourcePack,
          comparisonResult.selectedArtifact,
        );
        const canJudge =
          options.judge &&
          (options.maxJudge === null || state.judged < options.maxJudge);
        const judgeInput: FormulaJudgeRunInput | null =
          canJudge &&
          (options.judgeAll ||
            comparisonResult.requiresClaudeJudge ||
            parserDisagrees)
            ? {
                sourcePack,
                qwenOutput: qwenRun.parsedArtifact,
                codexOutput: codexRun.parsedArtifact,
                comparison: toJsonRecord(comparisonResult),
                deterministicParserOutput: sourcePack.knownParserOutput,
                evidence: toJsonRecord({
                  knownEvidence: sourcePack.knownEvidence,
                  knownCards: sourcePack.knownCards,
                }),
                highRisk:
                  comparisonResult.highRiskReasons.length > 0 ||
                  parserDisagrees,
              }
            : null;
        const judgeRun = judgeInput ? await judge.judge(judgeInput) : null;
        const skillFeedback = await skillRegistry.recordJudgeFeedback({
          sourcePack,
          judgeRun,
        });
        const artifact = await artifacts.persistCouncilRun({
          sourcePack,
          qwen: qwenRun,
          codex: codexRun,
          comparison: comparisonResult,
          judge: judgeRun,
          judgeInput,
          packet: null,
          skillFeedback,
          parserDisagrees,
          metadata: {
            triggeredBy: 'formula-ai-validate-all',
            batchRunId: state.runId,
          },
        });
        const matchedOrEquivalent =
          comparisonResult.agreementStatus === 'matched' ||
          comparisonResult.agreementStatus === 'equivalent';
        const result = {
          htsNumber: row.htsNumber,
          sourcePackId: sourcePack.sourcePackId,
          status: 'validated',
          qwenStatus: qwenRun.status,
          codexStatus: codexRun.status,
          agreementStatus: comparisonResult.agreementStatus,
          differenceCount: comparisonResult.differences.length,
          highRiskReasons: comparisonResult.highRiskReasons,
          requiresClaudeJudge: comparisonResult.requiresClaudeJudge,
          requiresHumanReview: comparisonResult.requiresHumanReview,
          parserDisagrees,
          judgeStatus: judgeRun?.status || null,
          judgeVerdict: judgeRun?.parsedArtifact?.judgeVerdict || null,
          judgeHumanReviewRequired:
            judgeRun?.parsedArtifact?.humanReviewRequired ?? null,
          councilRunId: artifact.runId,
          councilArtifactPath: artifact.artifactPath,
          startedAt,
          completedAt: new Date().toISOString(),
        };
        await appendFile(resultsPath, `${JSON.stringify(result)}\n`, 'utf8');
        state.succeeded++;
        state.completed++;
        state.compared++;
        if (judgeRun) state.judged++;
        if (comparisonResult.requiresHumanReview) state.humanReviewRequired++;
        if (comparisonResult.agreementStatus === 'different') state.different++;
        if (matchedOrEquivalent) state.matchedOrEquivalent++;
        state.lastHtsNumber = row.htsNumber;
        await writeState(options.outputDir, state);
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } catch (error) {
        const result = {
          htsNumber: row.htsNumber,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          startedAt,
          completedAt: new Date().toISOString(),
        };
        await appendFile(resultsPath, `${JSON.stringify(result)}\n`, 'utf8');
        state.failed++;
        state.completed++;
        state.lastHtsNumber = row.htsNumber;
        await writeState(options.outputDir, state);
        process.stdout.write(`${JSON.stringify(result)}\n`);
      }
    }
    await writeState(options.outputDir, state);
    process.stdout.write(
      `${JSON.stringify({ outputDir: options.outputDir, state }, null, 2)}\n`,
    );
  } finally {
    await dataSource.destroy();
  }
}

async function writeState(outputDir: string, state: BatchState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await writeFile(
    join(outputDir, 'state.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
