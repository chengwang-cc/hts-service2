import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  FormulaGenerationService,
  HtsStageDiffEntity,
  HtsStageEntryEntity,
  OpenAiService,
} from '@hts/core';
import { FORMULA_PARSER_FIXTURES } from '@hts/core/services/formula-parser.fixtures';
import { TariffEvidenceEntity } from '../../calculator/entities/tariff-evidence.entity';
import { validateFormulaArtifacts } from '../../calculator/services/formula-artifact-validator.service';
import { FormulaEvaluationService } from '../../calculator/services/formula-evaluation.service';
import { FormulaSemanticsService } from '../../calculator/services/formula-semantics.service';
import { FormulaVariable } from '../../calculator/services/tariff-types';
import { TariffSourceEntity } from '../../jurisdiction/entities/tariff-source.entity';
import { FormulaMaintenanceItemEntity } from '../entities/formula-maintenance-item.entity';
import { FormulaMaintenanceRunEntity } from '../entities/formula-maintenance-run.entity';

type JsonObject = Record<string, unknown>;

type MaintenanceClassification = 'trivial' | 'mechanical' | 'structural';

export interface RunMaintenanceOptions {
  importId?: string;
  limit?: number;
  dryRun?: boolean;
  aiEnabled?: boolean;
  includeParserGaps?: boolean;
}

interface FormulaRateParseResult {
  field: 'generalRate' | 'special' | 'other' | 'chapter99';
  rateText: string;
  formula: string;
  variables: string[];
  confidence: number;
}

interface DiffClassification {
  classification: MaintenanceClassification;
  reviewerStatus: 'collapsed' | 'pending_review' | 'escalated';
  reason: string;
  suggestedAction: string;
  parsedRates: FormulaRateParseResult[];
  parserGaps: Array<{ field: string; rateText: string; reason: string }>;
  deterministicSignals: JsonObject;
  aiRecommendation?: JsonObject | null;
  aiModel?: string | null;
}

export interface MaintenanceRunResult {
  runId: string | null;
  scanned: number;
  trivial: number;
  mechanical: number;
  structural: number;
  parserGaps: number;
  pendingEvidenceCreated: number;
  dryRun: boolean;
}

const RATE_FIELDS: FormulaRateParseResult['field'][] = [
  'generalRate',
  'special',
  'other',
  'chapter99',
];

@Injectable()
export class FormulaMaintenanceService {
  private readonly logger = new Logger(FormulaMaintenanceService.name);
  private readonly parserVersion = 'phase-12-maintenance-v1';

  constructor(
    @InjectRepository(FormulaMaintenanceRunEntity)
    private readonly runRepo: Repository<FormulaMaintenanceRunEntity>,
    @InjectRepository(FormulaMaintenanceItemEntity)
    private readonly itemRepo: Repository<FormulaMaintenanceItemEntity>,
    @InjectRepository(HtsStageDiffEntity)
    private readonly diffRepo: Repository<HtsStageDiffEntity>,
    @InjectRepository(HtsStageEntryEntity)
    private readonly stageRepo: Repository<HtsStageEntryEntity>,
    @InjectRepository(TariffEvidenceEntity)
    private readonly evidenceRepo: Repository<TariffEvidenceEntity>,
    @InjectRepository(TariffSourceEntity)
    private readonly sourceRepo: Repository<TariffSourceEntity>,
    private readonly formulaGeneration: FormulaGenerationService,
    private readonly formulaSemantics: FormulaSemanticsService,
    private readonly formulaEvaluation: FormulaEvaluationService,
    @Optional()
    private readonly openAiService?: OpenAiService,
  ) {}

  async runContinuousMaintenance(
    options: RunMaintenanceOptions = {},
  ): Promise<MaintenanceRunResult> {
    const limit = Math.min(Math.max(options.limit ?? 250, 1), 2000);
    const aiEnabled =
      options.aiEnabled ??
      process.env.FORMULA_MAINTENANCE_AI_ENABLED === 'true';
    const includeParserGaps = options.includeParserGaps ?? true;

    const run = this.runRepo.create({
      sourceType: options.importId ? 'usitc_revision' : 'scheduled',
      importId: options.importId || null,
      status: 'running',
      aiEnabled,
      summary: null,
      metadata: {
        dryRun: !!options.dryRun,
        parserVersion: this.parserVersion,
        startedAt: new Date().toISOString(),
      },
    });
    const savedRun = options.dryRun ? run : await this.runRepo.save(run);
    const runId = options.dryRun ? null : savedRun.id;

    const diffs = await this.loadRevisionDiffs({
      importId: options.importId,
      limit,
    });
    const stageEntries = await this.loadStageEntries(diffs);
    const result: MaintenanceRunResult = {
      runId,
      scanned: 0,
      trivial: 0,
      mechanical: 0,
      structural: 0,
      parserGaps: 0,
      pendingEvidenceCreated: 0,
      dryRun: !!options.dryRun,
    };

    try {
      for (const diff of diffs) {
        result.scanned++;
        const staged = diff.stageEntryId
          ? stageEntries.get(diff.stageEntryId) || null
          : null;
        const classification = await this.classifyDiff(diff, staged, {
          aiEnabled,
        });
        const evidenceIds =
          classification.classification === 'mechanical'
            ? await this.createPendingEvidenceForDiff({
                diff,
                staged,
                parsedRates: classification.parsedRates,
                dryRun: !!options.dryRun,
              })
            : [];

        if (classification.classification === 'trivial') result.trivial++;
        if (classification.classification === 'mechanical') result.mechanical++;
        if (classification.classification === 'structural') result.structural++;
        result.parserGaps += classification.parserGaps.length;
        result.pendingEvidenceCreated += evidenceIds.length;

        await this.persistItem({
          runId,
          itemType: 'usitc_diff',
          diff,
          classification,
          evidenceIds,
          dryRun: !!options.dryRun,
        });
      }

      if (includeParserGaps) {
        const parserGapItems = await this.generateParserGapItems({
          runId,
          limit: Math.min(limit, 250),
          dryRun: !!options.dryRun,
        });
        result.parserGaps += parserGapItems;
      }

      await this.completeRun(savedRun, result, !!options.dryRun);
      return result;
    } catch (error) {
      if (!options.dryRun && runId) {
        await this.runRepo.save({
          ...savedRun,
          status: 'failed',
          completedAt: new Date(),
          summary: {
            ...result,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      throw error;
    }
  }

  async latestRun(): Promise<FormulaMaintenanceRunEntity | null> {
    return this.runRepo.findOne({
      where: {},
      order: { createdAt: 'DESC' },
    });
  }

  async listItems(args: {
    runId?: string;
    classification?: string;
    reviewerStatus?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: FormulaMaintenanceItemEntity[]; total: number }> {
    const qb = this.itemRepo.createQueryBuilder('item');
    if (args.runId) {
      qb.andWhere('item.runId = :runId', { runId: args.runId });
    }
    if (args.classification) {
      qb.andWhere('item.classification = :classification', {
        classification: args.classification,
      });
    }
    if (args.reviewerStatus) {
      qb.andWhere('item.reviewerStatus = :reviewerStatus', {
        reviewerStatus: args.reviewerStatus,
      });
    }
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 1000);
    const offset = Math.max(args.offset ?? 0, 0);
    const [data, total] = await qb
      .orderBy('item.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();
    return { data, total };
  }

  private async loadRevisionDiffs(args: {
    importId?: string;
    limit: number;
  }): Promise<HtsStageDiffEntity[]> {
    const qb = this.diffRepo
      .createQueryBuilder('diff')
      .where('diff.diffType IN (:...diffTypes)', {
        diffTypes: ['ADDED', 'REMOVED', 'CHANGED'],
      })
      .orderBy('diff.createdAt', 'DESC')
      .addOrderBy('diff.htsNumber', 'ASC')
      .limit(args.limit);
    if (args.importId) {
      qb.andWhere('diff.importId = :importId', { importId: args.importId });
    }
    return qb.getMany();
  }

  private async loadStageEntries(
    diffs: HtsStageDiffEntity[],
  ): Promise<Map<string, HtsStageEntryEntity>> {
    const ids = Array.from(
      new Set(diffs.map((diff) => diff.stageEntryId).filter(Boolean)),
    ) as string[];
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.stageRepo.find({ where: { id: In(ids) } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async classifyDiff(
    diff: HtsStageDiffEntity,
    staged: HtsStageEntryEntity | null,
    options: { aiEnabled: boolean },
  ): Promise<DiffClassification> {
    const deterministic = this.deterministicClassifyDiff(diff, staged);
    if (!options.aiEnabled || !this.openAiService) {
      return deterministic;
    }

    const ai = await this.aiClassifyDiff(diff, deterministic);
    if (!ai) {
      return deterministic;
    }

    const aiClassification =
      typeof ai.classification === 'string' ? ai.classification : null;
    const aiConfidence =
      typeof ai.confidence === 'number' && Number.isFinite(ai.confidence)
        ? ai.confidence
        : 0;
    if (
      aiClassification === 'structural' &&
      deterministic.classification !== 'structural' &&
      aiConfidence >= 0.7
    ) {
      return {
        ...deterministic,
        classification: 'structural',
        reviewerStatus: 'escalated',
        reason:
          typeof ai.reason === 'string'
            ? `AI requested structural escalation: ${ai.reason}`
            : 'AI requested structural escalation.',
        suggestedAction:
          typeof ai.suggestedAction === 'string'
            ? ai.suggestedAction
            : 'Escalate to reviewer; keep AI output advisory and require deterministic re-validation before evidence creation.',
        aiRecommendation: ai,
        aiModel: String(
          ai.model ||
            process.env.FORMULA_MAINTENANCE_AI_MODEL ||
            'gpt-5.4-mini',
        ),
        deterministicSignals: {
          ...deterministic.deterministicSignals,
          aiUsed: true,
          aiEscalated: true,
        },
      };
    }

    return {
      ...deterministic,
      aiRecommendation: ai,
      aiModel: String(
        ai.model || process.env.FORMULA_MAINTENANCE_AI_MODEL || 'gpt-5.4-mini',
      ),
      deterministicSignals: {
        ...deterministic.deterministicSignals,
        aiUsed: true,
      },
    };
  }

  private deterministicClassifyDiff(
    diff: HtsStageDiffEntity,
    staged: HtsStageEntryEntity | null,
  ): DiffClassification {
    const changes = this.changeMap(diff.diffSummary);
    const changeKeys = Object.keys(changes);
    const parserGaps: DiffClassification['parserGaps'] = [];
    const parsedRates = staged
      ? this.parseRatesForEntry(staged, parserGaps)
      : [];
    const rateChangeKeys = changeKeys.filter((key) =>
      RATE_FIELDS.includes(key as FormulaRateParseResult['field']),
    );
    const structuralKeys = changeKeys.filter((key) =>
      ['footnotes', 'chapter99Links'].includes(key),
    );
    const trivialKeys = changeKeys.filter((key) =>
      ['description', 'indent', 'parentHtsNumber'].includes(key),
    );

    if (diff.diffType === 'REMOVED') {
      return {
        classification: 'structural',
        reviewerStatus: 'escalated',
        reason: 'HTS row was removed from the new revision.',
        suggestedAction:
          'Escalate to reviewer; verify whether existing cards/evidence must be sunset with effective dates.',
        parsedRates,
        parserGaps,
        deterministicSignals: { diffType: diff.diffType, changeKeys },
      };
    }

    if (
      diff.diffType === 'CHANGED' &&
      changeKeys.length > 0 &&
      changeKeys.length === trivialKeys.length
    ) {
      return {
        classification: 'trivial',
        reviewerStatus: 'collapsed',
        reason: 'Only description or hierarchy-display fields changed.',
        suggestedAction:
          'Auto-collapse for reviewer visibility; no formula evidence is required.',
        parsedRates: [],
        parserGaps: [],
        deterministicSignals: { diffType: diff.diffType, changeKeys },
      };
    }

    if (
      staged &&
      structuralKeys.length === 0 &&
      parserGaps.length === 0 &&
      (diff.diffType === 'ADDED' || rateChangeKeys.length > 0) &&
      parsedRates.length > 0
    ) {
      return {
        classification: 'mechanical',
        reviewerStatus: 'pending_review',
        reason:
          'Changed rate text was parsed deterministically and can be turned into pending evidence.',
        suggestedAction:
          'Create pending evidence and route to reviewer; do not publish without acceptance.',
        parsedRates,
        parserGaps,
        deterministicSignals: {
          diffType: diff.diffType,
          changeKeys,
          parsedRateFields: parsedRates.map((rate) => rate.field),
        },
      };
    }

    if (parserGaps.length > 0 || structuralKeys.length > 0) {
      return {
        classification: 'structural',
        reviewerStatus: 'escalated',
        reason:
          parserGaps.length > 0
            ? 'One or more rate texts could not be parsed deterministically.'
            : 'Footnotes or Chapter 99 links changed and need legal review.',
        suggestedAction:
          'Escalate with parser-gap suggestions, source text, and generated counterexamples.',
        parsedRates,
        parserGaps,
        deterministicSignals: {
          diffType: diff.diffType,
          changeKeys,
          parserGaps,
          structuralKeys,
        },
      };
    }

    return {
      classification: 'trivial',
      reviewerStatus: 'collapsed',
      reason: 'No formula-affecting change was detected.',
      suggestedAction:
        'Auto-collapse for reviewer visibility; keep in the maintenance audit trail.',
      parsedRates: [],
      parserGaps: [],
      deterministicSignals: { diffType: diff.diffType, changeKeys },
    };
  }

  private parseRatesForEntry(
    staged: HtsStageEntryEntity,
    parserGaps: DiffClassification['parserGaps'],
  ): FormulaRateParseResult[] {
    const parsed: FormulaRateParseResult[] = [];
    for (const field of RATE_FIELDS) {
      const rateText = this.stringField(staged[field]);
      if (!rateText) {
        continue;
      }
      if (this.isNoFormulaRate(rateText)) {
        parsed.push({
          field,
          rateText,
          formula: '0',
          variables: [],
          confidence: 1,
        });
        continue;
      }
      const result = this.formulaGeneration.generateFormulaByPattern(
        rateText,
        staged.unit || undefined,
      );
      if (!result) {
        parserGaps.push({
          field,
          rateText,
          reason: this.parserGapReason(rateText),
        });
        continue;
      }
      parsed.push({
        field,
        rateText,
        formula: result.formula,
        variables: result.variables,
        confidence: result.confidence,
      });
    }
    return parsed;
  }

  private async createPendingEvidenceForDiff(args: {
    diff: HtsStageDiffEntity;
    staged: HtsStageEntryEntity | null;
    parsedRates: FormulaRateParseResult[];
    dryRun: boolean;
  }): Promise<string[]> {
    if (!args.staged || args.parsedRates.length === 0) {
      return [];
    }
    const evidenceIds: string[] = [];
    const source = await this.resolveUsitcSource();
    for (const parsed of args.parsedRates) {
      const variables = this.variablesFor(parsed.variables);
      const semantic = this.formulaSemantics.analyze(parsed.formula, variables);
      const testVectors = this.generateTestVectors(parsed.formula, variables);
      const artifactValidation = validateFormulaArtifacts(
        {
          formulaText: parsed.formula,
          formulaAst: semantic.formulaAst,
          conditionAst: { kind: 'always' },
          unitDimensions:
            this.formulaSemantics.variablesToDimensions(variables),
          constraints: {},
          roundingPolicy: { mode: 'component_2dp' },
          testVectors,
        },
        { requireRuntimeArtifacts: true },
      );
      const validationErrors = [
        ...semantic.validationErrors,
        ...artifactValidation.errors,
      ];
      const sourceEffectiveFrom = this.resolveSourceEffectiveFrom(
        args.staged,
        args.diff,
      );
      const evidence = this.evidenceRepo.create({
        htsNumber: args.diff.htsNumber,
        countryCode: 'ALL',
        destinationCode: 'US',
        rateClass: this.rateClassFor(parsed.field),
        componentType: this.componentTypeFor(parsed.field),
        calculationStage: this.calculationStageFor(parsed.field),
        sourceId: source?.id || null,
        citationUrl: source?.sourceUrl || null,
        citationQuote: `USITC staged ${parsed.field}: ${parsed.rateText}`,
        citationSnapshotUri: `internal://hts-import/${args.diff.importId}/stage-diff/${args.diff.id}`,
        sourceEffectiveFrom,
        sourceEffectiveTo: null,
        retrievedAt: new Date(),
        rateText: parsed.rateText,
        formulaText: parsed.formula,
        formulaAst: semantic.formulaAst,
        formulaCanonical: semantic.canonicalFormula,
        compiledFormula: parsed.formula,
        formulaSemanticHash: semantic.semanticHash,
        conditionAst: { kind: 'always' },
        unitDimensions: this.formulaSemantics.variablesToDimensions(variables),
        constraints: {},
        roundingPolicy: { mode: 'component_2dp' },
        parserName: 'continuous-maintenance-deterministic',
        parserVersion: this.parserVersion,
        parserConfidence: parsed.confidence,
        aiModel: null,
        aiPromptVersion: null,
        validationStatus: validationErrors.length === 0 ? 'valid' : 'invalid',
        validationErrors: validationErrors.length > 0 ? validationErrors : null,
        testVectors,
        reviewerConfidence: null,
        reviewer: null,
        reviewedAt: null,
        status: 'pending',
        supersededBy: null,
        metadata: {
          source: 'formula-maintenance',
          importId: args.diff.importId,
          stageDiffId: args.diff.id,
          diffType: args.diff.diffType,
          field: parsed.field,
          artifactValidatorVersion: artifactValidation.validatorVersion,
          artifactValidationErrors: artifactValidation.errors,
        },
      });
      if (args.dryRun) {
        evidenceIds.push(`dry-run:${parsed.field}`);
      } else {
        const saved = await this.evidenceRepo.save(evidence);
        evidenceIds.push(saved.id);
      }
    }
    return evidenceIds;
  }

  private async generateParserGapItems(args: {
    runId: string | null;
    limit: number;
    dryRun: boolean;
  }): Promise<number> {
    const fixtureGaps = FORMULA_PARSER_FIXTURES.filter(
      (fixture) => fixture.expected === null,
    ).map((fixture) => ({
      htsNumber: null,
      rateText: fixture.rateText,
      source: 'parser-fixture',
      reason: this.parserGapReason(fixture.rateText),
      metadata: { fixtureName: fixture.name },
    }));

    const evidenceGaps = await this.evidenceRepo
      .createQueryBuilder('evidence')
      .where('evidence.rateText IS NOT NULL')
      .andWhere(
        '(evidence.compiledFormula IS NULL OR evidence.validationStatus IN (:...statuses))',
        { statuses: ['invalid', 'needs_review'] },
      )
      .orderBy('evidence.updatedAt', 'DESC')
      .limit(args.limit)
      .getMany();

    let count = 0;
    for (const gap of fixtureGaps) {
      count++;
      await this.persistParserGapItem({
        runId: args.runId,
        htsNumber: gap.htsNumber,
        rateText: gap.rateText,
        reason: gap.reason,
        metadata: gap.metadata,
        dryRun: args.dryRun,
      });
    }
    for (const evidence of evidenceGaps) {
      count++;
      await this.persistParserGapItem({
        runId: args.runId,
        htsNumber: evidence.htsNumber,
        rateText: evidence.rateText || '',
        reason: this.parserGapReason(evidence.rateText || ''),
        metadata: {
          evidenceId: evidence.id,
          parserName: evidence.parserName,
          parserVersion: evidence.parserVersion,
          validationErrors: evidence.validationErrors,
        },
        dryRun: args.dryRun,
      });
    }
    return count;
  }

  private async persistItem(args: {
    runId: string | null;
    itemType: string;
    diff: HtsStageDiffEntity;
    classification: DiffClassification;
    evidenceIds: string[];
    dryRun: boolean;
  }): Promise<void> {
    if (args.dryRun || !args.runId) {
      return;
    }
    await this.itemRepo.save(
      this.itemRepo.create({
        runId: args.runId,
        itemType: args.itemType,
        stageDiffId: args.diff.id,
        htsNumber: args.diff.htsNumber,
        classification: args.classification.classification,
        reviewerStatus: args.classification.reviewerStatus,
        reason: args.classification.reason,
        suggestedAction: args.classification.suggestedAction,
        pendingEvidenceId: args.evidenceIds[0] || null,
        pendingEvidenceIds:
          args.evidenceIds.length > 0 ? args.evidenceIds : null,
        deterministicSignals: args.classification.deterministicSignals,
        aiRecommendation: args.classification.aiRecommendation || null,
        aiModel: args.classification.aiModel || null,
        aiPromptVersion: args.classification.aiRecommendation
          ? this.parserVersion
          : null,
        generatedTestVectors:
          args.classification.parsedRates.flatMap((rate) =>
            this.generateTestVectors(
              rate.formula,
              this.variablesFor(rate.variables),
            ),
          ) || null,
        counterexamples:
          args.classification.parserGaps.length > 0
            ? args.classification.parserGaps.map((gap) =>
                this.counterexampleForGap(gap.rateText, gap.reason),
              )
            : null,
        metadata: {
          importId: args.diff.importId,
          diffType: args.diff.diffType,
          parserGaps: args.classification.parserGaps,
          parsedRates: args.classification.parsedRates,
        },
      }),
    );
  }

  private async persistParserGapItem(args: {
    runId: string | null;
    htsNumber: string | null;
    rateText: string;
    reason: string;
    metadata: JsonObject;
    dryRun: boolean;
  }): Promise<void> {
    if (args.dryRun || !args.runId) {
      return;
    }
    await this.itemRepo.save(
      this.itemRepo.create({
        runId: args.runId,
        itemType: 'parser_gap',
        stageDiffId: null,
        htsNumber: args.htsNumber,
        classification: 'parser_gap',
        reviewerStatus: 'pending_review',
        reason: args.reason,
        suggestedAction: this.parserGapSuggestion(args.rateText),
        pendingEvidenceId: null,
        pendingEvidenceIds: null,
        deterministicSignals: {
          rateText: args.rateText,
          parserVersion: this.parserVersion,
        },
        aiRecommendation: null,
        aiModel: null,
        aiPromptVersion: null,
        generatedTestVectors: [],
        counterexamples: [
          this.counterexampleForGap(args.rateText, args.reason),
        ],
        metadata: args.metadata,
      }),
    );
  }

  private async resolveUsitcSource(): Promise<TariffSourceEntity | null> {
    return this.sourceRepo.findOne({
      where: {
        jurisdictionCode: 'US',
        sourceName: 'USITC HTS JSON',
      },
    });
  }

  private resolveSourceEffectiveFrom(
    staged: HtsStageEntryEntity,
    diff: HtsStageDiffEntity,
  ): string {
    const normalized =
      staged.normalized && typeof staged.normalized === 'object'
        ? staged.normalized
        : {};
    const rawItem =
      staged.rawItem && typeof staged.rawItem === 'object'
        ? staged.rawItem
        : {};
    const candidates = [
      normalized.effectiveDate,
      normalized.effectiveFrom,
      rawItem.effectiveDate,
      rawItem.effectiveFrom,
      this.dateFromVersion(staged.sourceVersion),
      diff.createdAt instanceof Date
        ? diff.createdAt.toISOString().slice(0, 10)
        : null,
      new Date().toISOString().slice(0, 10),
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') {
        continue;
      }
      const match = candidate.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
      if (match) {
        return match[0];
      }
    }
    return new Date().toISOString().slice(0, 10);
  }

  private dateFromVersion(version: string | null | undefined): string | null {
    if (!version) {
      return null;
    }
    const iso = version.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) {
      return iso[0];
    }
    const year = version.match(/\b(20\d{2})\b/);
    return year ? `${year[1]}-01-01` : null;
  }

  private async completeRun(
    run: FormulaMaintenanceRunEntity,
    result: MaintenanceRunResult,
    dryRun: boolean,
  ): Promise<void> {
    if (dryRun) {
      return;
    }
    await this.runRepo.save({
      ...run,
      status: 'completed',
      itemsScanned: result.scanned,
      trivialCount: result.trivial,
      mechanicalCount: result.mechanical,
      structuralCount: result.structural,
      parserGapCount: result.parserGaps,
      pendingEvidenceCreated: result.pendingEvidenceCreated,
      completedAt: new Date(),
      summary: {
        ...result,
        runId: run.id,
      },
    });
  }

  private async aiClassifyDiff(
    diff: HtsStageDiffEntity,
    deterministic: DiffClassification,
  ): Promise<JsonObject | null> {
    try {
      const response = await this.openAiService!.response(
        JSON.stringify({
          diff: {
            id: diff.id,
            htsNumber: diff.htsNumber,
            diffType: diff.diffType,
            diffSummary: diff.diffSummary,
          },
          deterministic,
          instruction:
            'Classify this HTS revision diff for reviewer triage. Never recommend publishing directly.',
        }),
        {
          model: process.env.FORMULA_MAINTENANCE_AI_MODEL || 'gpt-5.4-mini',
          max_output_tokens: 1200,
          text: {
            format: {
              type: 'json_schema',
              name: 'formula_maintenance_classification',
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  classification: {
                    type: 'string',
                    enum: ['trivial', 'mechanical', 'structural'],
                  },
                  confidence: { type: 'number' },
                  reason: { type: 'string' },
                  suggestedAction: { type: 'string' },
                  model: { type: 'string' },
                },
                required: [
                  'classification',
                  'confidence',
                  'reason',
                  'suggestedAction',
                  'model',
                ],
              },
              strict: true,
            },
          },
        },
      );
      return this.parseJsonObject((response as any).output_text);
    } catch (error) {
      this.logger.warn(
        `AI maintenance classification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private parseJsonObject(value: unknown): JsonObject | null {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private generateTestVectors(
    formula: string,
    variables: FormulaVariable[],
  ): Array<Record<string, unknown>> {
    const baseInputs = this.defaultInputsFor(variables);
    const highInputs = Object.fromEntries(
      Object.entries(baseInputs).map(([key, value]) => [
        key,
        typeof value === 'number' ? value * 10 : value,
      ]),
    );
    return [
      this.vectorFor(formula, variables, 'base', baseInputs),
      this.vectorFor(formula, variables, 'high', highInputs),
    ].filter((item): item is Record<string, unknown> => item !== null);
  }

  private vectorFor(
    formula: string,
    variables: FormulaVariable[],
    name: string,
    inputs: Record<string, number>,
  ): Record<string, unknown> | null {
    try {
      const amount = this.formulaEvaluation.evaluateWithConstraints(
        formula,
        {
          ...inputs,
          additionalInputs: inputs,
          declaredVariables: variables.map((variable) => variable.name),
        },
        { rounding: 'component_2dp' },
      ).amount;
      return { name, inputs, expectedAmount: amount, tolerance: 0.01 };
    } catch (error) {
      return {
        name,
        inputs,
        expectedAmount: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private defaultInputsFor(
    variables: FormulaVariable[],
  ): Record<string, number> {
    const out: Record<string, number> = {
      value: 1000,
      weight: 100,
      quantity: 24,
      duty: 100,
      total: 1100,
    };
    for (const variable of variables) {
      if (variable.name === 'quantity_dozen') out[variable.name] = 2;
      else if (variable.name === 'quantity_pair') out[variable.name] = 12;
      else if (variable.name === 'quantity_each') out[variable.name] = 24;
      else if (variable.name === 'quantity_gross') out[variable.name] = 1;
      else if (variable.name === 'volume_liter') out[variable.name] = 10;
      else if (variable.name === 'proof_liter') out[variable.name] = 10;
      else if (variable.name === 'volume_barrel') out[variable.name] = 10;
      else if (variable.name === 'volume_m3') out[variable.name] = 10;
      else if (variable.name === 'weight_ton') out[variable.name] = 1;
      else if (variable.name === 'area_m2') out[variable.name] = 10;
      else if (variable.name === 'length_m') out[variable.name] = 10;
      else if (!(variable.name in out)) out[variable.name] = 10;
    }
    return out;
  }

  private variablesFor(names: string[]): FormulaVariable[] {
    return Array.from(new Set(names)).map((name) => ({
      name,
      type: 'number',
      dimension: this.dimensionForVariable(name),
    }));
  }

  private dimensionForVariable(name: string): FormulaVariable['dimension'] {
    if (name.includes('value') || name === 'duty' || name === 'total') {
      return 'money';
    }
    if (name.includes('weight')) return 'weight';
    if (name.includes('volume') || name.includes('liter')) return 'volume';
    if (name.includes('area')) return 'area';
    if (name.includes('length')) return 'length';
    return 'quantity';
  }

  private changeMap(summary: Record<string, unknown> | null): JsonObject {
    const changes = summary?.changes;
    return changes && typeof changes === 'object' && !Array.isArray(changes)
      ? (changes as JsonObject)
      : {};
  }

  private stringField(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private isNoFormulaRate(rateText: string): boolean {
    return /^(free|none|n\/a|no|nil|0%?)$/i.test(rateText.trim());
  }

  private parserGapReason(rateText: string): string {
    const lower = rateText.toLowerCase();
    if (lower.includes('see') || lower.includes('note')) {
      return 'Rate text depends on legal notes or external references.';
    }
    if (lower.includes('not less') || lower.includes('not over')) {
      return 'Rate text contains minimum/maximum language that needs constraints.';
    }
    if (lower.includes('quota')) {
      return 'Quota rate requires quota-aware condition modeling.';
    }
    if (/\bor\b|\bwhichever\b|\bbut\b/i.test(rateText)) {
      return 'Rate text contains alternate or conditional clauses.';
    }
    return 'Rate text is not covered by deterministic parser patterns.';
  }

  private parserGapSuggestion(rateText: string): string {
    const reason = this.parserGapReason(rateText);
    if (reason.includes('minimum/maximum')) {
      return 'Add a parser branch that emits constraints.minAmount/maxAmount and validation vectors at both bounds.';
    }
    if (reason.includes('Quota')) {
      return 'Add condition AST support for quota scope before parsing this rate into evidence.';
    }
    if (reason.includes('legal notes')) {
      return 'Retrieve the cited note text and attach it as source evidence before formula parsing.';
    }
    return 'Cluster with similar failed rate texts and add a deterministic parser fixture before enabling AI proposals.';
  }

  private counterexampleForGap(
    rateText: string,
    reason: string,
  ): Record<string, unknown> {
    return {
      rateText,
      reason,
      counterexample:
        'Parser must reject or mark needs_review until formula, units, constraints, and condition AST are explicit.',
      requiredFields: [
        'formulaAst',
        'unitDimensions',
        'conditionAst',
        'constraints',
        'testVectors',
      ],
    };
  }

  private rateClassFor(field: FormulaRateParseResult['field']): string {
    switch (field) {
      case 'special':
        return 'SPECIAL';
      case 'other':
        return 'OTHER';
      case 'chapter99':
        return 'CHAPTER_99';
      case 'generalRate':
      default:
        return 'GENERAL';
    }
  }

  private componentTypeFor(field: FormulaRateParseResult['field']): string {
    switch (field) {
      case 'special':
        return 'special';
      case 'other':
        return 'non_ntr';
      case 'chapter99':
        return 'chapter_99';
      case 'generalRate':
      default:
        return 'base';
    }
  }

  private calculationStageFor(field: FormulaRateParseResult['field']): string {
    return field === 'chapter99' ? 'additional_duty' : 'base';
  }
}
