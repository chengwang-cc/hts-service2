import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FormulaSemanticsService,
  TariffEvidenceEntity,
  TariffKnowledgeCardEntity,
  TariffRateBatchService,
  validateFormulaArtifacts,
} from '@hts/calculator';
import { TariffSourceEntity } from '../../jurisdiction/entities/tariff-source.entity';
import { BrokerGoldenSetCaseEntity } from '../entities/broker-golden-set-case.entity';
import { EvidenceReconciliationService } from './evidence-reconciliation.service';

type JsonObject = Record<string, unknown>;

export interface BrokerGoldenSetCaseInput {
  brokerName: string;
  brokerReference: string;
  htsNumber: string;
  originCountry: string;
  destinationCountry?: string;
  entryDate: string;
  declaredValue: number;
  currency?: string;
  inputs?: JsonObject;
  expectedTotalDuty: number;
  expectedComponents: JsonObject[];
  citations?: JsonObject[] | null;
  brokerConfidence?: number | null;
  metadata?: JsonObject | null;
}

export interface ValidateGoldenSetOptions {
  limit?: number;
  tolerance?: number;
  brokerName?: string;
  dryRun?: boolean;
}

export interface ValidateGoldenSetResult {
  scanned: number;
  matched: number;
  mismatched: number;
  failed: number;
  dryRun: boolean;
}

@Injectable()
export class BrokerGoldenSetService {
  constructor(
    @InjectRepository(BrokerGoldenSetCaseEntity)
    private readonly caseRepo: Repository<BrokerGoldenSetCaseEntity>,
    @InjectRepository(TariffEvidenceEntity)
    private readonly evidenceRepo: Repository<TariffEvidenceEntity>,
    @InjectRepository(TariffKnowledgeCardEntity)
    private readonly cardRepo: Repository<TariffKnowledgeCardEntity>,
    @InjectRepository(TariffSourceEntity)
    private readonly sourceRepo: Repository<TariffSourceEntity>,
    private readonly tariffRateBatch: TariffRateBatchService,
    private readonly formulaSemantics: FormulaSemanticsService,
    private readonly reconciliation: EvidenceReconciliationService,
  ) {}

  async upsertCase(
    input: BrokerGoldenSetCaseInput,
  ): Promise<BrokerGoldenSetCaseEntity> {
    const existing = await this.caseRepo.findOne({
      where: {
        brokerName: input.brokerName,
        brokerReference: input.brokerReference,
      },
    });
    const values = {
      brokerName: input.brokerName,
      brokerReference: input.brokerReference,
      htsNumber: input.htsNumber,
      originCountry: input.originCountry.toUpperCase(),
      destinationCountry: (input.destinationCountry || 'US').toUpperCase(),
      entryDate: input.entryDate,
      declaredValue: input.declaredValue,
      currency: (input.currency || 'USD').toUpperCase(),
      inputs: input.inputs || {},
      expectedTotalDuty: input.expectedTotalDuty,
      expectedComponents: input.expectedComponents,
      citations: input.citations || null,
      status: 'active',
      lastValidatedAt: new Date(),
      brokerConfidence: input.brokerConfidence ?? null,
      metadata: input.metadata || null,
    };

    const saved = await this.caseRepo.save(
      existing ? { ...existing, ...values } : this.caseRepo.create(values),
    );
    const evidenceIds = await this.createEvidenceCandidates(saved);
    if (evidenceIds.length === 0) {
      return saved;
    }
    return this.caseRepo.save({
      ...saved,
      metadata: {
        ...(saved.metadata || {}),
        evidenceCandidateIds: evidenceIds,
      },
    });
  }

  async activeCaseCount(): Promise<number> {
    return this.caseRepo.count({ where: { status: 'active' } });
  }

  async validateActiveCases(
    options: ValidateGoldenSetOptions = {},
  ): Promise<ValidateGoldenSetResult> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 1000);
    const tolerance = options.tolerance ?? 0.01;
    const qb = this.caseRepo
      .createQueryBuilder('brokerCase')
      .where('brokerCase.status = :status', { status: 'active' })
      .orderBy('brokerCase.lastValidatedAt', 'ASC', 'NULLS FIRST')
      .addOrderBy('brokerCase.createdAt', 'ASC')
      .limit(limit);

    if (options.brokerName) {
      qb.andWhere('brokerCase.brokerName = :brokerName', {
        brokerName: options.brokerName,
      });
    }

    const cases = await qb.getMany();
    const result: ValidateGoldenSetResult = {
      scanned: cases.length,
      matched: 0,
      mismatched: 0,
      failed: 0,
      dryRun: !!options.dryRun,
    };

    for (const brokerCase of cases) {
      try {
        const [calculated] = await this.tariffRateBatch.batchCalculate(
          [
            {
              htsCode: brokerCase.htsNumber,
              country: brokerCase.originCountry,
              entryDate: brokerCase.entryDate,
              inputs: this.buildNumericInputs(brokerCase),
            },
          ],
          { failOnComponentError: true },
        );
        const delta =
          calculated.totalDuty - Number(brokerCase.expectedTotalDuty);
        const matched = !calculated.blocked && Math.abs(delta) <= tolerance;
        if (matched) {
          result.matched++;
        } else {
          result.mismatched++;
        }

        if (!options.dryRun) {
          await this.caseRepo.save({
            ...brokerCase,
            lastValidatedAt: new Date(),
            metadata: {
              ...(brokerCase.metadata || {}),
              lastValidation: {
                matched,
                tolerance,
                calculatedTotalDuty: calculated.totalDuty,
                expectedTotalDuty: Number(brokerCase.expectedTotalDuty),
                delta,
                blocked: calculated.blocked,
                blockReason: calculated.blockReason,
                componentCount: calculated.breakdown.length,
                validatedAt: new Date().toISOString(),
              },
            },
          });
          await this.updateBrokerCardMetadata(brokerCase, matched);
          if (!matched) {
            await this.createReconciliationPacketForBrokerMismatch(brokerCase, {
              calculatedTotalDuty: calculated.totalDuty,
              expectedTotalDuty: Number(brokerCase.expectedTotalDuty),
              delta,
              blocked: calculated.blocked,
              blockReason: calculated.blockReason,
              componentCount: calculated.breakdown.length,
            });
          }
        }
      } catch (error) {
        result.failed++;
        if (!options.dryRun) {
          await this.caseRepo.save({
            ...brokerCase,
            lastValidatedAt: new Date(),
            metadata: {
              ...(brokerCase.metadata || {}),
              lastValidation: {
                matched: false,
                error: error instanceof Error ? error.message : String(error),
                validatedAt: new Date().toISOString(),
              },
            },
          });
        }
      }
    }

    return result;
  }

  private async createEvidenceCandidates(
    brokerCase: BrokerGoldenSetCaseEntity,
  ): Promise<string[]> {
    const source = await this.sourceRepo.findOne({
      where: { jurisdictionCode: 'US', sourceName: 'Broker Golden Set' },
    });
    const evidenceIds: string[] = [];
    const components = Array.isArray(brokerCase.expectedComponents)
      ? brokerCase.expectedComponents
      : [];

    for (const [index, component] of components.entries()) {
      const formula = this.optionalString(
        component.formula || component.formulaText || component.compiledFormula,
      );
      if (!formula) {
        continue;
      }
      const componentType = this.normalizeComponentType(component);
      const rateClass = this.normalizeRateClass(component, componentType);
      const semantic = this.formulaSemantics.analyze(formula);
      const snapshotUri = `internal://broker-golden-set/${brokerCase.brokerName}/${brokerCase.brokerReference}/${index}`;
      const existing = await this.evidenceRepo
        .createQueryBuilder('evidence')
        .where('evidence.htsNumber = :htsNumber', {
          htsNumber: brokerCase.htsNumber,
        })
        .andWhere('evidence.countryCode = :countryCode', {
          countryCode: brokerCase.originCountry,
        })
        .andWhere('evidence.destinationCode = :destinationCode', {
          destinationCode: brokerCase.destinationCountry,
        })
        .andWhere('evidence.rateClass = :rateClass', { rateClass })
        .andWhere('evidence.componentType = :componentType', { componentType })
        .andWhere('evidence.citationSnapshotUri = :snapshotUri', {
          snapshotUri,
        })
        .andWhere('evidence.formulaSemanticHash = :semanticHash', {
          semanticHash: semantic.semanticHash,
        })
        .getOne();
      if (existing) {
        evidenceIds.push(existing.id);
        continue;
      }

      const expectedAmount = this.optionalNumber(
        component.amount || component.expectedAmount || component.duty,
      );
      const conditionAst = this.conditionAst(component);
      const unitDimensions = {};
      const constraints = this.optionalRecord(component.constraints) || {};
      const roundingPolicy = this.optionalRecord(component.roundingPolicy) || {
        mode: 'component_2dp',
      };
      const testVectors =
        expectedAmount === null
          ? null
          : [
              {
                name: 'broker-case',
                inputs: brokerCase.inputs || {},
                expectedAmount,
                tolerance: 0.01,
              },
            ];
      const artifactValidation = validateFormulaArtifacts(
        {
          formulaText: formula,
          formulaAst: semantic.formulaAst,
          conditionAst,
          unitDimensions,
          constraints,
          roundingPolicy,
          testVectors: testVectors || undefined,
        },
        { requireRuntimeArtifacts: true },
      );
      const validationErrors = [
        ...semantic.validationErrors,
        ...artifactValidation.errors,
      ];
      const saved = await this.evidenceRepo.save(
        this.evidenceRepo.create({
          htsNumber: brokerCase.htsNumber,
          countryCode: brokerCase.originCountry,
          destinationCode: brokerCase.destinationCountry,
          rateClass,
          componentType,
          calculationStage: this.calculationStage(componentType),
          sourceId: source?.id || null,
          citationUrl: source?.sourceUrl || null,
          citationQuote: this.brokerCitationQuote(brokerCase, component),
          citationSnapshotUri: snapshotUri,
          sourceEffectiveFrom: brokerCase.entryDate,
          sourceEffectiveTo: null,
          retrievedAt: new Date(),
          rateText: this.optionalString(component.rateText) || null,
          formulaText: formula,
          formulaAst: semantic.formulaAst,
          formulaCanonical: semantic.canonicalFormula,
          compiledFormula: formula,
          formulaSemanticHash: semantic.semanticHash,
          conditionAst,
          unitDimensions,
          constraints,
          roundingPolicy,
          parserName: 'broker-golden-set-import',
          parserVersion: 'phase-6-broker-evidence-v1',
          parserConfidence: brokerCase.brokerConfidence ?? 0.95,
          aiModel: null,
          aiPromptVersion: null,
          validationStatus:
            validationErrors.length === 0 ? 'valid' : 'needs_review',
          validationErrors:
            validationErrors.length > 0 ? validationErrors : null,
          testVectors,
          reviewerConfidence: null,
          reviewer: null,
          reviewedAt: null,
          status: 'pending',
          supersededBy: null,
          metadata: {
            source: 'broker-golden-set',
            brokerCaseId: brokerCase.id,
            brokerName: brokerCase.brokerName,
            brokerReference: brokerCase.brokerReference,
            componentIndex: index,
            artifactValidatorVersion: artifactValidation.validatorVersion,
            artifactValidationErrors: artifactValidation.errors,
          },
        }),
      );
      evidenceIds.push(saved.id);
    }

    return evidenceIds;
  }

  private async updateBrokerCardMetadata(
    brokerCase: BrokerGoldenSetCaseEntity,
    matched: boolean,
  ): Promise<void> {
    const cards = await this.cardRepo
      .createQueryBuilder('card')
      .where('card.htsNumber = :htsNumber', { htsNumber: brokerCase.htsNumber })
      .andWhere('card.countryCode IN (:...countryCodes)', {
        countryCodes: [brokerCase.originCountry, 'ALL'],
      })
      .andWhere('card.destinationCode = :destinationCode', {
        destinationCode: brokerCase.destinationCountry,
      })
      .andWhere('card.status IN (:...statuses)', {
        statuses: ['authoritative', 'provisional', 'disputed'],
      })
      .getMany();
    for (const card of cards) {
      await this.cardRepo.save({
        ...card,
        metadata: {
          ...(card.metadata || {}),
          brokerGoldenSetMatch: matched,
          brokerGoldenSetCaseId: brokerCase.id,
          brokerGoldenSetLastValidatedAt: new Date().toISOString(),
        },
      });
    }
  }

  private async createReconciliationPacketForBrokerMismatch(
    brokerCase: BrokerGoldenSetCaseEntity,
    validation: JsonObject,
  ): Promise<void> {
    try {
      await this.reconciliation.createPacketForScope({
        htsNumber: brokerCase.htsNumber,
        countryCode: brokerCase.originCountry,
        destinationCode: brokerCase.destinationCountry,
        reason: 'broker_golden_set_mismatch',
        metadata: {
          brokerCaseId: brokerCase.id,
          brokerName: brokerCase.brokerName,
          brokerReference: brokerCase.brokerReference,
          validation,
        },
      });
    } catch {
      // Validation remains authoritative; reconciliation can be retried from
      // the saved broker-case metadata if packet creation fails.
    }
  }

  private buildNumericInputs(
    brokerCase: BrokerGoldenSetCaseEntity,
  ): Record<string, number> {
    const inputs: Record<string, number> = {
      value: Number(brokerCase.declaredValue),
    };
    for (const [key, value] of Object.entries(brokerCase.inputs || {})) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue;
      }
      inputs[key] = value;
    }
    return inputs;
  }

  private normalizeComponentType(component: JsonObject): string {
    const value = this.optionalString(
      component.componentType || component.tariffType || component.type,
    );
    return (value || 'base').toLowerCase();
  }

  private normalizeRateClass(
    component: JsonObject,
    componentType: string,
  ): string {
    const value = this.optionalString(
      component.rateClass || component.tariffType,
    );
    return value || componentType;
  }

  private calculationStage(componentType: string): string {
    if (componentType === 'mpf' || componentType === 'hmf') {
      return 'post_calculation_fee';
    }
    if (componentType === 'post_tax') {
      return 'tax';
    }
    if (componentType === 'base' || componentType === 'non_ntr') {
      return 'base';
    }
    return 'additional_duty';
  }

  private conditionAst(component: JsonObject): JsonObject {
    return (
      this.optionalRecord(component.conditionAst) ||
      this.optionalRecord(component.conditions) || { kind: 'always' }
    );
  }

  private brokerCitationQuote(
    brokerCase: BrokerGoldenSetCaseEntity,
    component: JsonObject,
  ): string {
    const componentQuote = this.optionalString(component.citationQuote);
    if (componentQuote) {
      return componentQuote;
    }
    const citation = Array.isArray(brokerCase.citations)
      ? brokerCase.citations[0]
      : null;
    return (
      this.optionalString(citation?.quote) ||
      `Broker ${brokerCase.brokerName} reference ${brokerCase.brokerReference}`
    );
  }

  private optionalRecord(value: unknown): JsonObject | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : null;
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private optionalNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}
