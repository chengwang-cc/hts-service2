import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TariffCardShadowComparisonEntity,
  TariffEvidenceEntity,
  TariffKnowledgeCardEntity,
} from '../entities';

export interface TariffConfidenceInput {
  htsNumber: string;
  countryCode: string;
  destinationCode?: string;
  rateClass?: string;
  componentType?: string;
  fallbackConfidence?: number | null;
}

export interface TariffConfidenceSummary {
  score: number;
  label: 'high' | 'medium' | 'low' | 'review';
  source: 'knowledge-card' | 'evidence' | 'fallback';
  basedOn: {
    cardId: string | null;
    cardStatus: string | null;
    evidenceCount: number;
    agreementScore: number | null;
    freshnessDays: number | null;
    brokerGoldenSetMatch: boolean | null;
    shadowPendingMismatches: number;
    latestEvidenceAt: string | null;
  };
  caveats: string[];
}

@Injectable()
export class TariffConfidenceService {
  constructor(
    @InjectRepository(TariffKnowledgeCardEntity)
    private readonly cardRepo: Repository<TariffKnowledgeCardEntity>,
    @InjectRepository(TariffEvidenceEntity)
    private readonly evidenceRepo: Repository<TariffEvidenceEntity>,
    @InjectRepository(TariffCardShadowComparisonEntity)
    private readonly shadowRepo: Repository<TariffCardShadowComparisonEntity>,
  ) {}

  async scoreFor(
    input: TariffConfidenceInput,
  ): Promise<TariffConfidenceSummary> {
    const htsNumber = (input.htsNumber || '').trim();
    const countryCode = (input.countryCode || '').trim().toUpperCase();
    const destinationCode = (input.destinationCode || 'US').toUpperCase();
    const countryCodes = Array.from(
      new Set([countryCode, 'ALL'].filter(Boolean)),
    );

    const [card, evidenceStats, shadowPendingMismatches] = await Promise.all([
      this.findBestCard({
        htsNumber,
        countryCode,
        countryCodes,
        destinationCode,
        rateClass: input.rateClass,
        componentType: input.componentType,
      }),
      this.evidenceStats({
        htsNumber,
        countryCodes,
        destinationCode,
        rateClass: input.rateClass,
        componentType: input.componentType,
      }),
      this.shadowRepo
        .createQueryBuilder('comparison')
        .where('comparison.htsNumber = :htsNumber', { htsNumber })
        .andWhere('comparison.countryCode IN (:...countryCodes)', {
          countryCodes,
        })
        .andWhere('comparison.destinationCode = :destinationCode', {
          destinationCode,
        })
        .andWhere('comparison.status = :status', { status: 'pending' })
        .getCount(),
    ]);

    const caveats: string[] = [];
    const freshnessDays = card
      ? this.daysSince(card.lastReviewedAt || card.updatedAt || card.createdAt)
      : null;
    const evidenceCount = card
      ? Math.max(Number(card.evidenceCount || 0), evidenceStats.evidenceCount)
      : evidenceStats.evidenceCount;
    const agreementScore =
      card && card.agreementScore !== null
        ? this.clamp01(Number(card.agreementScore))
        : null;
    const cardConfidence =
      card && card.confidenceScore !== null
        ? this.clamp01(Number(card.confidenceScore))
        : null;
    const fallbackConfidence =
      input.fallbackConfidence === null ||
      input.fallbackConfidence === undefined
        ? null
        : this.clamp01(Number(input.fallbackConfidence));

    if (!card) {
      caveats.push('No knowledge card matched this HTS/country scope.');
    } else if (card.status === 'disputed') {
      caveats.push('The selected knowledge card is disputed.');
    } else if (card.status !== 'authoritative') {
      caveats.push(`Knowledge card status is ${card.status}.`);
    }

    if (evidenceCount === 0) {
      caveats.push('No accepted evidence rows were found for this scope.');
    }
    if (freshnessDays !== null && freshnessDays > 90) {
      caveats.push(
        `Knowledge card has not been reviewed in ${freshnessDays} days.`,
      );
    }
    if (shadowPendingMismatches > 0) {
      caveats.push(
        `${shadowPendingMismatches} pending card-vs-legacy shadow mismatch(es) exist for this scope.`,
      );
    }

    const score = this.calculateScore({
      card,
      cardConfidence,
      fallbackConfidence,
      agreementScore,
      evidenceCount,
      freshnessDays,
      shadowPendingMismatches,
    });

    return {
      score,
      label: this.label(score),
      source: card
        ? 'knowledge-card'
        : evidenceCount > 0
          ? 'evidence'
          : 'fallback',
      basedOn: {
        cardId: card?.id || null,
        cardStatus: card?.status || null,
        evidenceCount,
        agreementScore,
        freshnessDays,
        brokerGoldenSetMatch: this.brokerGoldenSetMatch(card),
        shadowPendingMismatches,
        latestEvidenceAt: evidenceStats.latestEvidenceAt,
      },
      caveats,
    };
  }

  private async findBestCard(args: {
    htsNumber: string;
    countryCode: string;
    countryCodes: string[];
    destinationCode: string;
    rateClass?: string;
    componentType?: string;
  }): Promise<TariffKnowledgeCardEntity | null> {
    const qb = this.cardRepo
      .createQueryBuilder('card')
      .where('card.htsNumber = :htsNumber', { htsNumber: args.htsNumber })
      .andWhere('card.countryCode IN (:...countryCodes)', {
        countryCodes: args.countryCodes,
      })
      .andWhere('card.destinationCode = :destinationCode', {
        destinationCode: args.destinationCode,
      })
      .andWhere('card.status IN (:...statuses)', {
        statuses: ['authoritative', 'provisional', 'disputed'],
      });

    if (args.rateClass) {
      qb.andWhere('card.rateClass = :rateClass', {
        rateClass: args.rateClass,
      });
    }
    if (args.componentType) {
      qb.andWhere('card.componentType = :componentType', {
        componentType: args.componentType,
      });
    }

    const candidates = await qb
      .orderBy('card.effectiveFrom', 'DESC')
      .addOrderBy('card.updatedAt', 'DESC')
      .limit(20)
      .getMany();

    return (
      candidates.sort((a, b) => {
        const countryRank =
          this.countryRank(a.countryCode, args.countryCode) -
          this.countryRank(b.countryCode, args.countryCode);
        if (countryRank !== 0) return countryRank;
        const statusRank =
          this.statusRank(a.status) - this.statusRank(b.status);
        if (statusRank !== 0) return statusRank;
        return Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
      })[0] || null
    );
  }

  private async evidenceStats(args: {
    htsNumber: string;
    countryCodes: string[];
    destinationCode: string;
    rateClass?: string;
    componentType?: string;
  }): Promise<{ evidenceCount: number; latestEvidenceAt: string | null }> {
    const qb = this.evidenceRepo
      .createQueryBuilder('evidence')
      .where('evidence.htsNumber = :htsNumber', { htsNumber: args.htsNumber })
      .andWhere('evidence.countryCode IN (:...countryCodes)', {
        countryCodes: args.countryCodes,
      })
      .andWhere('evidence.destinationCode = :destinationCode', {
        destinationCode: args.destinationCode,
      })
      .andWhere('evidence.status = :status', { status: 'accepted' })
      .andWhere('evidence.validationStatus = :validationStatus', {
        validationStatus: 'valid',
      });

    if (args.rateClass) {
      qb.andWhere('evidence.rateClass = :rateClass', {
        rateClass: args.rateClass,
      });
    }
    if (args.componentType) {
      qb.andWhere('evidence.componentType = :componentType', {
        componentType: args.componentType,
      });
    }

    const row = await qb
      .select('COUNT(*)', 'evidenceCount')
      .addSelect('MAX(evidence.retrievedAt)', 'latestEvidenceAt')
      .getRawOne<{ evidenceCount: string; latestEvidenceAt: Date | null }>();

    return {
      evidenceCount: Number(row?.evidenceCount || 0),
      latestEvidenceAt: row?.latestEvidenceAt
        ? new Date(row.latestEvidenceAt).toISOString()
        : null,
    };
  }

  private calculateScore(args: {
    card: TariffKnowledgeCardEntity | null;
    cardConfidence: number | null;
    fallbackConfidence: number | null;
    agreementScore: number | null;
    evidenceCount: number;
    freshnessDays: number | null;
    shadowPendingMismatches: number;
  }): number {
    const evidenceScore = Math.min(args.evidenceCount, 3) / 3;
    const freshnessScore =
      args.freshnessDays === null
        ? 0.5
        : args.freshnessDays <= 30
          ? 1
          : args.freshnessDays <= 90
            ? 0.85
            : args.freshnessDays <= 180
              ? 0.65
              : 0.45;
    const shadowScore =
      args.shadowPendingMismatches === 0
        ? 1
        : Math.max(0.4, 1 - args.shadowPendingMismatches * 0.1);

    let score: number;
    if (args.card) {
      score =
        (args.cardConfidence ?? args.fallbackConfidence ?? 0.5) * 0.35 +
        (args.agreementScore ?? 0.5) * 0.25 +
        evidenceScore * 0.2 +
        freshnessScore * 0.1 +
        shadowScore * 0.1;
      if (args.card.status === 'disputed') {
        score -= 0.2;
      } else if (args.card.status !== 'authoritative') {
        score -= 0.08;
      }
    } else {
      score =
        (args.fallbackConfidence ?? 0.5) * 0.5 +
        evidenceScore * 0.3 +
        shadowScore * 0.2;
    }

    return Math.round(this.clamp01(score) * 10000) / 10000;
  }

  private countryRank(cardCountry: string, requestedCountry: string): number {
    if (cardCountry === requestedCountry) return 0;
    if (cardCountry === 'ALL') return 1;
    return 2;
  }

  private statusRank(status: string): number {
    switch (status) {
      case 'authoritative':
        return 0;
      case 'provisional':
        return 1;
      case 'disputed':
        return 2;
      default:
        return 3;
    }
  }

  private brokerGoldenSetMatch(
    card: TariffKnowledgeCardEntity | null,
  ): boolean | null {
    const value = card?.metadata?.brokerGoldenSetMatch;
    return typeof value === 'boolean' ? value : null;
  }

  private label(score: number): TariffConfidenceSummary['label'] {
    if (score >= 0.9) return 'high';
    if (score >= 0.75) return 'medium';
    if (score >= 0.5) return 'low';
    return 'review';
  }

  private daysSince(date: Date): number {
    const ms = Date.now() - date.getTime();
    return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }
}
