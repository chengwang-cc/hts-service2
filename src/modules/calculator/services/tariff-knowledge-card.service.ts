import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TariffEvidenceEntity } from '../entities/tariff-evidence.entity';
import { TariffKnowledgeCardEntity } from '../entities/tariff-knowledge-card.entity';
import {
  FormulaArtifactValidationResult,
  validateFormulaArtifacts,
} from './formula-artifact-validator.service';
import { FormulaSemanticsService } from './formula-semantics.service';

type JsonObject = Record<string, unknown>;

export interface RecomputeKnowledgeCardsOptions {
  htsNumber?: string;
  countryCode?: string;
  destinationCode?: string;
  rateClass?: string;
  componentType?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface RecomputeKnowledgeCardsResult {
  scopesScanned: number;
  cardsUpserted: number;
  disputedCards: number;
  dryRun: boolean;
}

type CardScope = {
  htsNumber: string;
  countryCode: string;
  destinationCode: string;
  rateClass: string;
  componentType: string;
  effectiveFrom: string;
};

type ConsensusBucket = {
  key: string;
  evidence: TariffEvidenceEntity[];
  averageConfidence: number;
  latestActivityTime: number;
};

@Injectable()
export class TariffKnowledgeCardService {
  private readonly logger = new Logger(TariffKnowledgeCardService.name);

  constructor(
    @InjectRepository(TariffEvidenceEntity)
    private readonly evidenceRepo: Repository<TariffEvidenceEntity>,
    @InjectRepository(TariffKnowledgeCardEntity)
    private readonly cardRepo: Repository<TariffKnowledgeCardEntity>,
    private readonly semantics: FormulaSemanticsService,
  ) {}

  async recomputeCards(
    options: RecomputeKnowledgeCardsOptions = {},
  ): Promise<RecomputeKnowledgeCardsResult> {
    const scopes = await this.loadEvidenceScopes(options);
    let cardsUpserted = 0;
    let disputedCards = 0;

    for (const scope of scopes) {
      const result = await this.recomputeScope(scope, !!options.dryRun);
      if (result.upserted) {
        cardsUpserted++;
      }
      if (result.disputed) {
        disputedCards++;
      }
    }

    this.logger.log(
      `tariff-card-recompute: scopes=${scopes.length} cardsUpserted=${cardsUpserted} disputed=${disputedCards} dryRun=${!!options.dryRun}`,
    );

    return {
      scopesScanned: scopes.length,
      cardsUpserted,
      disputedCards,
      dryRun: !!options.dryRun,
    };
  }

  private async loadEvidenceScopes(
    options: RecomputeKnowledgeCardsOptions,
  ): Promise<CardScope[]> {
    const limit = Math.min(Math.max(options.limit ?? 1000, 1), 25000);
    const qb = this.evidenceRepo
      .createQueryBuilder('evidence')
      .select('evidence.htsNumber', 'htsNumber')
      .addSelect('evidence.countryCode', 'countryCode')
      .addSelect('evidence.destinationCode', 'destinationCode')
      .addSelect('evidence.rateClass', 'rateClass')
      .addSelect('evidence.componentType', 'componentType')
      .addSelect(
        "COALESCE(evidence.sourceEffectiveFrom, '1970-01-01')",
        'effectiveFrom',
      )
      .where('evidence.status = :status', { status: 'accepted' })
      .andWhere('evidence.validationStatus = :validationStatus', {
        validationStatus: 'valid',
      })
      .andWhere('evidence.formulaText IS NOT NULL')
      .andWhere('evidence.supersededBy IS NULL');

    if (options.htsNumber) {
      qb.andWhere('evidence.htsNumber = :htsNumber', {
        htsNumber: options.htsNumber,
      });
    }
    if (options.countryCode) {
      qb.andWhere('evidence.countryCode = :countryCode', {
        countryCode: options.countryCode.toUpperCase(),
      });
    }
    if (options.destinationCode) {
      qb.andWhere('evidence.destinationCode = :destinationCode', {
        destinationCode: options.destinationCode.toUpperCase(),
      });
    }
    if (options.rateClass) {
      qb.andWhere('evidence.rateClass = :rateClass', {
        rateClass: options.rateClass,
      });
    }
    if (options.componentType) {
      qb.andWhere('evidence.componentType = :componentType', {
        componentType: options.componentType,
      });
    }

    qb.groupBy('evidence.htsNumber')
      .addGroupBy('evidence.countryCode')
      .addGroupBy('evidence.destinationCode')
      .addGroupBy('evidence.rateClass')
      .addGroupBy('evidence.componentType')
      .addGroupBy("COALESCE(evidence.sourceEffectiveFrom, '1970-01-01')")
      .orderBy('evidence.htsNumber', 'ASC')
      .addOrderBy('evidence.countryCode', 'ASC')
      .addOrderBy('evidence.rateClass', 'ASC')
      .limit(limit);

    return qb.getRawMany<CardScope>();
  }

  private async recomputeScope(
    scope: CardScope,
    dryRun: boolean,
  ): Promise<{ upserted: boolean; disputed: boolean }> {
    const evidence = await this.loadScopeEvidence(scope);
    if (evidence.length === 0) {
      return { upserted: false, disputed: false };
    }

    const buckets = this.buildConsensusBuckets(evidence);
    const winner = buckets[0];
    const representative = this.pickRepresentativeEvidence(winner.evidence);
    const formula = representative.formulaText || '';
    const analyzed = this.semantics.analyze(formula);
    const artifactValidation = validateFormulaArtifacts(
      {
        formulaText: formula,
        formulaAst: representative.formulaAst || analyzed.formulaAst,
        conditionAst: representative.conditionAst || { kind: 'always' },
        unitDimensions: representative.unitDimensions || {},
        constraints: representative.constraints || {},
        roundingPolicy: representative.roundingPolicy || {
          mode: 'component_2dp',
        },
        testVectors: representative.testVectors || undefined,
      },
      { requireRuntimeArtifacts: true },
    );
    const validationErrors = this.collectValidationErrors(
      representative,
      [...analyzed.validationErrors, ...artifactValidation.errors],
    );
    const disagreementCount = evidence.length - winner.evidence.length;
    const agreementScore = winner.evidence.length / evidence.length;
    const confidenceScore = this.round4(
      Math.min(1, winner.averageConfidence * agreementScore),
    );
    const disputed = disagreementCount > 0;
    const status = disputed
      ? 'disputed'
      : validationErrors.length > 0
        ? 'provisional'
        : 'authoritative';

    if (!dryRun) {
      const existing = await this.cardRepo.findOne({ where: scope });
      await this.cardRepo.save(
        existing
          ? {
              ...existing,
              ...this.buildCardValues({
                evidence,
                buckets,
                representative,
                analyzed,
                agreementScore,
                confidenceScore,
                disagreementCount,
                validationErrors,
                artifactValidation,
                status,
              }),
            }
          : this.cardRepo.create({
              ...scope,
              ...this.buildCardValues({
                evidence,
                buckets,
                representative,
                analyzed,
                agreementScore,
                confidenceScore,
                disagreementCount,
                validationErrors,
                artifactValidation,
                status,
              }),
            }),
      );
    }

    return { upserted: true, disputed };
  }

  private async loadScopeEvidence(
    scope: CardScope,
  ): Promise<TariffEvidenceEntity[]> {
    return this.evidenceRepo
      .createQueryBuilder('evidence')
      .where('evidence.htsNumber = :htsNumber', {
        htsNumber: scope.htsNumber,
      })
      .andWhere('evidence.countryCode = :countryCode', {
        countryCode: scope.countryCode,
      })
      .andWhere('evidence.destinationCode = :destinationCode', {
        destinationCode: scope.destinationCode,
      })
      .andWhere('evidence.rateClass = :rateClass', {
        rateClass: scope.rateClass,
      })
      .andWhere('evidence.componentType = :componentType', {
        componentType: scope.componentType,
      })
      .andWhere(
        "COALESCE(evidence.sourceEffectiveFrom, '1970-01-01') = :effectiveFrom",
        { effectiveFrom: scope.effectiveFrom },
      )
      .andWhere('evidence.status = :status', { status: 'accepted' })
      .andWhere('evidence.validationStatus = :validationStatus', {
        validationStatus: 'valid',
      })
      .andWhere('evidence.formulaText IS NOT NULL')
      .andWhere('evidence.supersededBy IS NULL')
      .orderBy('evidence.reviewedAt', 'DESC', 'NULLS LAST')
      .addOrderBy('evidence.retrievedAt', 'DESC')
      .getMany();
  }

  private buildConsensusBuckets(
    evidence: TariffEvidenceEntity[],
  ): ConsensusBucket[] {
    const buckets = new Map<string, TariffEvidenceEntity[]>();
    for (const item of evidence) {
      const key =
        item.formulaSemanticHash ||
        this.normalizeFormulaKey(item.formulaCanonical || item.formulaText);
      const current = buckets.get(key) || [];
      current.push(item);
      buckets.set(key, current);
    }

    return Array.from(buckets.entries())
      .map(([key, values]) => ({
        key,
        evidence: values,
        averageConfidence: this.averageConfidence(values),
        latestActivityTime: Math.max(
          ...values.map((item) =>
            (item.reviewedAt || item.retrievedAt || item.updatedAt).getTime(),
          ),
        ),
      }))
      .sort((a, b) => {
        if (b.evidence.length !== a.evidence.length) {
          return b.evidence.length - a.evidence.length;
        }
        if (b.averageConfidence !== a.averageConfidence) {
          return b.averageConfidence - a.averageConfidence;
        }
        return b.latestActivityTime - a.latestActivityTime;
      });
  }

  private pickRepresentativeEvidence(
    evidence: TariffEvidenceEntity[],
  ): TariffEvidenceEntity {
    return [...evidence].sort((a, b) => {
      const confidenceDelta =
        this.evidenceConfidence(b) - this.evidenceConfidence(a);
      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }
      return (
        (b.reviewedAt || b.retrievedAt || b.updatedAt).getTime() -
        (a.reviewedAt || a.retrievedAt || a.updatedAt).getTime()
      );
    })[0];
  }

  private buildCardValues(args: {
    evidence: TariffEvidenceEntity[];
    buckets: ConsensusBucket[];
    representative: TariffEvidenceEntity;
    analyzed: ReturnType<FormulaSemanticsService['analyze']>;
    agreementScore: number;
    confidenceScore: number;
    disagreementCount: number;
    validationErrors: string[];
    artifactValidation: FormulaArtifactValidationResult;
    status: string;
  }): Partial<TariffKnowledgeCardEntity> {
    const {
      evidence,
      buckets,
      representative,
      analyzed,
      agreementScore,
      confidenceScore,
      disagreementCount,
      validationErrors,
      artifactValidation,
      status,
    } = args;

    return {
      effectiveTo: representative.sourceEffectiveTo || null,
      consensusFormula: representative.formulaText,
      consensusFormulaAst: representative.formulaAst || analyzed.formulaAst,
      consensusConditionAst:
        representative.conditionAst || ({ kind: 'always' } as JsonObject),
      consensusConstraints: representative.constraints || {},
      consensusRoundingPolicy: representative.roundingPolicy || {
        mode: 'component_2dp',
      },
      consensusSemanticHash:
        representative.formulaSemanticHash || analyzed.semanticHash,
      agreementScore: this.round4(agreementScore),
      confidenceScore,
      evidenceCount: evidence.length,
      disagreementCount,
      openQuestions:
        disagreementCount > 0 || validationErrors.length > 0
          ? this.buildOpenQuestions(buckets, validationErrors)
          : null,
      status,
      lastReviewedAt: representative.reviewedAt || null,
      reviewer: representative.reviewer || null,
      metadata: {
        recomputedAt: new Date().toISOString(),
        consensusEvidenceId: representative.id,
        consensusEvidenceIds: args.buckets[0].evidence.map((item) => item.id),
        parserName: representative.parserName,
        parserVersion: representative.parserVersion,
        artifactValidatorVersion: artifactValidation.validatorVersion,
        artifactValidationErrors: artifactValidation.errors,
      },
    };
  }

  private buildOpenQuestions(
    buckets: ConsensusBucket[],
    validationErrors: string[],
  ): JsonObject[] {
    const questions: JsonObject[] = [];
    if (buckets.length > 1) {
      questions.push({
        kind: 'formula_disagreement',
        formulas: buckets.map((bucket) => ({
          key: bucket.key,
          evidenceCount: bucket.evidence.length,
          averageConfidence: this.round4(bucket.averageConfidence),
          evidenceIds: bucket.evidence.map((item) => item.id),
        })),
      });
    }
    if (validationErrors.length > 0) {
      questions.push({
        kind: 'validation_errors',
        errors: validationErrors,
      });
    }
    return questions;
  }

  private collectValidationErrors(
    evidence: TariffEvidenceEntity,
    analyzedErrors: string[],
  ): string[] {
    const errors = new Set<string>();
    for (const error of evidence.validationErrors || []) {
      errors.add(error);
    }
    for (const error of analyzedErrors || []) {
      errors.add(error);
    }
    if (evidence.validationStatus && evidence.validationStatus !== 'valid') {
      errors.add(`validation_status:${evidence.validationStatus}`);
    }
    return Array.from(errors);
  }

  private averageConfidence(evidence: TariffEvidenceEntity[]): number {
    if (evidence.length === 0) {
      return 0;
    }
    return (
      evidence.reduce((sum, item) => sum + this.evidenceConfidence(item), 0) /
      evidence.length
    );
  }

  private evidenceConfidence(item: TariffEvidenceEntity): number {
    const raw = item.reviewerConfidence ?? item.parserConfidence ?? 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 0;
  }

  private normalizeFormulaKey(value: string | null | undefined): string {
    return (value || '').replace(/\s+/g, '').toLowerCase();
  }

  private round4(value: number): number {
    return Math.round(value * 10000) / 10000;
  }
}
