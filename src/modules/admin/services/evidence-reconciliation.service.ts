import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OpenAiService } from '@hts/core';
import {
  TariffEvidenceEntity,
  TariffKnowledgeCardEntity,
} from '@hts/calculator';
import { Repository } from 'typeorm';
import { EvidenceReconciliationPacketEntity } from '../entities/evidence-reconciliation-packet.entity';
import { CbpCrossRulingService } from './cbp-cross-ruling.service';

type JsonObject = Record<string, unknown>;

export interface ReconcileEvidenceOptions {
  cardId?: string;
  limit?: number;
  aiEnabled?: boolean;
}

export interface ReconcileEvidenceResult {
  cardsScanned: number;
  packetsCreated: number;
  aiRecommendations: number;
}

export interface CreateReconciliationPacketForScopeOptions {
  htsNumber: string;
  countryCode: string;
  destinationCode?: string;
  rateClass?: string;
  componentType?: string;
  reason: string;
  metadata?: JsonObject | null;
}

@Injectable()
export class EvidenceReconciliationService {
  private readonly logger = new Logger(EvidenceReconciliationService.name);
  private readonly promptVersion = 'evidence-reconcile-v1';

  constructor(
    @InjectRepository(TariffKnowledgeCardEntity)
    private readonly cardRepo: Repository<TariffKnowledgeCardEntity>,
    @InjectRepository(TariffEvidenceEntity)
    private readonly evidenceRepo: Repository<TariffEvidenceEntity>,
    @InjectRepository(EvidenceReconciliationPacketEntity)
    private readonly packetRepo: Repository<EvidenceReconciliationPacketEntity>,
    private readonly crossRulings: CbpCrossRulingService,
    private readonly openAiService: OpenAiService,
  ) {}

  async reconcileDisputedCards(
    options: ReconcileEvidenceOptions = {},
  ): Promise<ReconcileEvidenceResult> {
    const cards = await this.loadCards(options);
    let packetsCreated = 0;
    let aiRecommendations = 0;

    for (const card of cards) {
      const packet = await this.buildPacket(card, !!options.aiEnabled);
      await this.packetRepo.save(packet);
      packetsCreated++;
      if (packet.aiModel) {
        aiRecommendations++;
      }
    }

    this.logger.log(
      `evidence-reconcile: cards=${cards.length} packets=${packetsCreated} ai=${aiRecommendations}`,
    );

    return {
      cardsScanned: cards.length,
      packetsCreated,
      aiRecommendations,
    };
  }

  async createPacketForScope(
    options: CreateReconciliationPacketForScopeOptions,
  ): Promise<EvidenceReconciliationPacketEntity | null> {
    const countryCode = options.countryCode.toUpperCase();
    const destinationCode = (options.destinationCode || 'US').toUpperCase();
    const qb = this.cardRepo
      .createQueryBuilder('card')
      .where('card.htsNumber = :htsNumber', { htsNumber: options.htsNumber })
      .andWhere('card.countryCode IN (:...countryCodes)', {
        countryCodes: [countryCode, 'ALL'],
      })
      .andWhere('card.destinationCode = :destinationCode', {
        destinationCode,
      })
      .andWhere('card.status IN (:...statuses)', {
        statuses: ['authoritative', 'provisional', 'disputed'],
      })
      .orderBy(
        `CASE WHEN card.countryCode = :countryCode THEN 0 ELSE 1 END`,
        'ASC',
      )
      .addOrderBy('card.updatedAt', 'DESC')
      .setParameter('countryCode', countryCode)
      .limit(1);

    if (options.rateClass) {
      qb.andWhere('card.rateClass = :rateClass', {
        rateClass: options.rateClass,
      });
    }
    if (options.componentType) {
      qb.andWhere('card.componentType = :componentType', {
        componentType: options.componentType,
      });
    }

    const card = await qb.getOne();
    if (!card) {
      return null;
    }
    const packet = await this.buildPacket(card, false);
    packet.metadata = {
      ...(packet.metadata || {}),
      trigger: {
        reason: options.reason,
        htsNumber: options.htsNumber,
        countryCode,
        destinationCode,
        rateClass: options.rateClass || null,
        componentType: options.componentType || null,
        ...(options.metadata || {}),
      },
    };
    return this.packetRepo.save(packet);
  }

  private async loadCards(
    options: ReconcileEvidenceOptions,
  ): Promise<TariffKnowledgeCardEntity[]> {
    if (options.cardId) {
      const card = await this.cardRepo.findOne({
        where: { id: options.cardId },
      });
      return card ? [card] : [];
    }
    return this.cardRepo.find({
      where: { status: 'disputed' },
      order: { updatedAt: 'DESC' },
      take: Math.min(Math.max(options.limit ?? 25, 1), 250),
    });
  }

  private async buildPacket(
    card: TariffKnowledgeCardEntity,
    aiEnabled: boolean,
  ): Promise<EvidenceReconciliationPacketEntity> {
    const [acceptedEvidence, pendingEvidence, crossRulings] = await Promise.all(
      [
        this.loadEvidence(card, ['accepted']),
        this.loadEvidence(card, ['pending', 'needs_review', 'disputed']),
        this.crossRulings.findRelevantRulingsForHts(card.htsNumber, 5, {
          description: this.cardDescription(card),
          formulaText: card.consensusFormula,
          componentType: card.componentType,
        }),
      ],
    );

    const cardSnapshot = this.compactCard(card);
    const acceptedSnapshot = acceptedEvidence.map((item) =>
      this.compactEvidence(item),
    );
    const pendingSnapshot = pendingEvidence.map((item) =>
      this.compactEvidence(item),
    );
    const crossSnapshot = crossRulings.map((ruling) => ({
      id: ruling.id,
      rulingNumber: ruling.rulingNumber,
      subject: ruling.subject,
      rulingDate: ruling.rulingDate,
      htsNumbers: ruling.htsNumbers,
      sourceUrl: ruling.sourceUrl,
      excerpt: ruling.rulingText.slice(0, 1200),
      retrieval: ruling.metadata?.reconciliationRetrieval || null,
    }));

    const recommendation = aiEnabled
      ? await this.recommendWithAi({
          cardSnapshot,
          acceptedEvidence: acceptedSnapshot,
          pendingEvidence: pendingSnapshot,
          crossRulings: crossSnapshot,
        })
      : this.deterministicRecommendation(
          acceptedSnapshot,
          pendingSnapshot,
          crossSnapshot,
        );

    return this.packetRepo.create({
      cardId: card.id,
      cardScope: {
        htsNumber: card.htsNumber,
        countryCode: card.countryCode,
        destinationCode: card.destinationCode,
        rateClass: card.rateClass,
        componentType: card.componentType,
        effectiveFrom: card.effectiveFrom,
      },
      cardSnapshot,
      acceptedEvidence: acceptedSnapshot,
      pendingEvidence: pendingSnapshot,
      crossRulings: crossSnapshot,
      recommendation: recommendation.recommendation,
      recommendationText: recommendation.text,
      aiModel: recommendation.aiModel,
      aiPromptVersion: recommendation.aiModel ? this.promptVersion : null,
      confidence: recommendation.confidence,
      status: 'pending_review',
      metadata: {
        source: 'evidence-reconciliation-service',
        generatedAt: new Date().toISOString(),
      },
    });
  }

  private async loadEvidence(
    card: TariffKnowledgeCardEntity,
    statuses: string[],
  ): Promise<TariffEvidenceEntity[]> {
    return this.evidenceRepo
      .createQueryBuilder('evidence')
      .where('evidence.htsNumber = :htsNumber', {
        htsNumber: card.htsNumber,
      })
      .andWhere('evidence.countryCode IN (:...countryCodes)', {
        countryCodes: [card.countryCode, 'ALL'],
      })
      .andWhere('evidence.destinationCode = :destinationCode', {
        destinationCode: card.destinationCode,
      })
      .andWhere('evidence.rateClass = :rateClass', {
        rateClass: card.rateClass,
      })
      .andWhere('evidence.componentType = :componentType', {
        componentType: card.componentType,
      })
      .andWhere('evidence.status IN (:...statuses)', { statuses })
      .orderBy('evidence.reviewedAt', 'DESC', 'NULLS LAST')
      .addOrderBy('evidence.retrievedAt', 'DESC')
      .limit(25)
      .getMany();
  }

  private async recommendWithAi(args: {
    cardSnapshot: JsonObject;
    acceptedEvidence: JsonObject[];
    pendingEvidence: JsonObject[];
    crossRulings: JsonObject[];
  }): Promise<{
    recommendation: JsonObject;
    text: string;
    confidence: number | null;
    aiModel: string | null;
  }> {
    try {
      const response = await this.openAiService.response(JSON.stringify(args), {
        model: process.env.EVIDENCE_RECONCILE_AI_MODEL || 'gpt-5.4-mini',
        instructions:
          'You are preparing reviewer commentary for tariff formula reconciliation. Do not approve or publish. Use only supplied evidence and cite evidence ids or CROSS ruling numbers.',
        max_output_tokens: 2500,
        text: {
          format: {
            type: 'json_schema',
            name: 'evidence_reconciliation_recommendation',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                verdict: { type: 'string' },
                confidence: { type: 'number' },
                summary: { type: 'string' },
                recommendedActions: {
                  type: 'array',
                  items: { type: 'string' },
                },
                citations: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: [
                'verdict',
                'confidence',
                'summary',
                'recommendedActions',
                'citations',
              ],
            },
            strict: true,
          },
        },
      });
      const recommendation = JSON.parse(
        (response as any).output_text || '{}',
      ) as JsonObject;
      return {
        recommendation,
        text:
          typeof recommendation.summary === 'string'
            ? recommendation.summary
            : 'AI recommendation generated for reviewer packet.',
        confidence:
          typeof recommendation.confidence === 'number'
            ? recommendation.confidence
            : null,
        aiModel: response.model,
      };
    } catch (error) {
      return {
        recommendation: {
          verdict: 'needs_human_review',
          error: error instanceof Error ? error.message : String(error),
        },
        text: 'AI reconciliation failed; packet requires human review.',
        confidence: null,
        aiModel: null,
      };
    }
  }

  private deterministicRecommendation(
    acceptedEvidence: JsonObject[],
    pendingEvidence: JsonObject[],
    crossRulings: JsonObject[],
  ): {
    recommendation: JsonObject;
    text: string;
    confidence: number | null;
    aiModel: null;
  } {
    return {
      recommendation: {
        verdict: 'needs_human_review',
        acceptedEvidenceCount: acceptedEvidence.length,
        pendingEvidenceCount: pendingEvidence.length,
        crossRulingCount: crossRulings.length,
        recommendedActions: [
          'Review conflicting formulas and source citation quotes.',
          'Check relevant CROSS rulings before accepting or rejecting evidence.',
          'Accept evidence only after deterministic validation and reviewer approval.',
        ],
      },
      text: 'Disputed card packet prepared for human review; no automated authority was applied.',
      confidence: null,
      aiModel: null,
    };
  }

  private compactCard(card: TariffKnowledgeCardEntity): JsonObject {
    return {
      id: card.id,
      htsNumber: card.htsNumber,
      countryCode: card.countryCode,
      destinationCode: card.destinationCode,
      rateClass: card.rateClass,
      componentType: card.componentType,
      effectiveFrom: card.effectiveFrom,
      effectiveTo: card.effectiveTo,
      consensusFormula: card.consensusFormula,
      consensusSemanticHash: card.consensusSemanticHash,
      agreementScore: Number(card.agreementScore),
      confidenceScore: Number(card.confidenceScore),
      evidenceCount: card.evidenceCount,
      disagreementCount: card.disagreementCount,
      openQuestions: card.openQuestions,
      status: card.status,
    };
  }

  private cardDescription(card: TariffKnowledgeCardEntity): string {
    return [
      card.htsNumber,
      card.countryCode,
      card.rateClass,
      card.componentType,
      card.consensusFormula,
      ...(card.openQuestions || []).map((question) =>
        JSON.stringify(question),
      ),
    ]
      .filter((value): value is string => typeof value === 'string')
      .join('\n')
      .slice(0, 4000);
  }

  private compactEvidence(evidence: TariffEvidenceEntity): JsonObject {
    return {
      id: evidence.id,
      htsNumber: evidence.htsNumber,
      countryCode: evidence.countryCode,
      destinationCode: evidence.destinationCode,
      rateClass: evidence.rateClass,
      componentType: evidence.componentType,
      sourceId: evidence.sourceId,
      citationUrl: evidence.citationUrl,
      citationSnapshotUri: evidence.citationSnapshotUri,
      citationQuote: evidence.citationQuote,
      rateText: evidence.rateText,
      formulaText: evidence.formulaText,
      formulaAst: evidence.formulaAst,
      formulaSemanticHash: evidence.formulaSemanticHash,
      conditionAst: evidence.conditionAst,
      unitDimensions: evidence.unitDimensions,
      constraints: evidence.constraints,
      roundingPolicy: evidence.roundingPolicy,
      testVectors: evidence.testVectors,
      parserName: evidence.parserName,
      parserVersion: evidence.parserVersion,
      parserConfidence: evidence.parserConfidence,
      reviewerConfidence: evidence.reviewerConfidence,
      validationStatus: evidence.validationStatus,
      validationErrors: evidence.validationErrors,
      status: evidence.status,
    };
  }
}
