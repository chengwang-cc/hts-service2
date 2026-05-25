import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEventEntity } from '../../audit/entities/audit-event.entity';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../../broker-entries/entities';
import {
  BrokerDocumentPacketEntity,
  BrokerExtractedFieldEntity,
} from '../../broker-packets/entities';
import {
  BrokerAiSuggestionEntity,
  BrokerDecisionEntity,
} from '../../broker-decisions/entities';
import {
  MarketplaceBrokerMatchEntity,
  MarketplaceConversationEntity,
  MarketplaceQuoteEntity,
  MarketplaceRequestEntity,
} from '../../marketplace-requests/entities';
import { MarketplaceReviewEntity } from '../../marketplace-reviews/entities';

@Injectable()
export class BrokerAdminService {
  constructor(
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    @InjectRepository(BrokerEntryLineEntity)
    private readonly lines: Repository<BrokerEntryLineEntity>,
    @InjectRepository(BrokerDocumentPacketEntity)
    private readonly packets: Repository<BrokerDocumentPacketEntity>,
    @InjectRepository(BrokerExtractedFieldEntity)
    private readonly fields: Repository<BrokerExtractedFieldEntity>,
    @InjectRepository(BrokerAiSuggestionEntity)
    private readonly suggestions: Repository<BrokerAiSuggestionEntity>,
    @InjectRepository(BrokerDecisionEntity)
    private readonly decisions: Repository<BrokerDecisionEntity>,
    @InjectRepository(MarketplaceRequestEntity)
    private readonly requests: Repository<MarketplaceRequestEntity>,
    @InjectRepository(MarketplaceQuoteEntity)
    private readonly quotes: Repository<MarketplaceQuoteEntity>,
    @InjectRepository(MarketplaceBrokerMatchEntity)
    private readonly matches: Repository<MarketplaceBrokerMatchEntity>,
    @InjectRepository(MarketplaceConversationEntity)
    private readonly conversations: Repository<MarketplaceConversationEntity>,
    @InjectRepository(MarketplaceReviewEntity)
    private readonly reviews: Repository<MarketplaceReviewEntity>,
    @InjectRepository(AuditEventEntity)
    private readonly audits: Repository<AuditEventEntity>,
  ) {}

  /**
   * Admin marketplace overview: counts grouped by status, plus 30-day deltas
   * so the platform team can see whether matched/quoted/selected funnel is
   * healthy.
   */
  async marketplaceQuality() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [
      requestsTotal,
      requestsLast30,
      matchesTotal,
      matchesDeclined,
      quotesTotal,
      quotesAccepted,
      reviewsTotal,
      reviewsPending,
      averageRatingRaw,
    ] = await Promise.all([
      this.requests.count(),
      this.requests
        .createQueryBuilder('r')
        .where('r.createdAt >= :since', { since })
        .getCount(),
      this.matches.count(),
      this.matches
        .createQueryBuilder('m')
        .where('m.status = :status', { status: 'declined' })
        .getCount(),
      this.quotes.count(),
      this.quotes
        .createQueryBuilder('q')
        .where('q.status = :status', { status: 'accepted' })
        .getCount(),
      this.reviews.count(),
      this.reviews
        .createQueryBuilder('r')
        .where('r.moderationStatus = :status', { status: 'pending' })
        .getCount(),
      this.reviews
        .createQueryBuilder('r')
        .where('r.moderationStatus = :status', { status: 'approved' })
        .select('AVG(r.rating)', 'avg')
        .getRawOne<{ avg: string | null }>(),
    ]);

    const acceptanceRate =
      quotesTotal > 0 ? quotesAccepted / quotesTotal : null;
    const declineRate =
      matchesTotal > 0 ? matchesDeclined / matchesTotal : null;

    return {
      requests: { total: requestsTotal, last30Days: requestsLast30 },
      matches: { total: matchesTotal, declined: matchesDeclined, declineRate },
      quotes: { total: quotesTotal, accepted: quotesAccepted, acceptanceRate },
      reviews: {
        total: reviewsTotal,
        pending: reviewsPending,
        averageRating: averageRatingRaw?.avg
          ? Number(averageRatingRaw.avg)
          : null,
      },
    };
  }

  async listAllRequests(params: { status?: string } = {}) {
    const qb = this.requests
      .createQueryBuilder('r')
      .orderBy('r.createdAt', 'DESC')
      .take(100);
    if (params.status) {
      qb.andWhere('r.status = :status', { status: params.status });
    }
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  /**
   * Platform analytics: throughput + automation rate across all tenants.
   * Numbers are deliberately coarse-grained for the admin dashboard.
   */
  async brokerAnalytics() {
    const [
      entriesTotal,
      entriesApproved,
      entriesExported,
      entriesRejected,
      packetsTotal,
      packetsExtracted,
      suggestionsTotal,
      suggestionsAccepted,
      decisionsTotal,
      licensedRequired,
      licensedSatisfied,
    ] = await Promise.all([
      this.entries.count(),
      this.entries
        .createQueryBuilder('e')
        .where('e.status IN (:...statuses)', {
          statuses: ['approved', 'exported', 'transmitted', 'accepted'],
        })
        .getCount(),
      this.entries
        .createQueryBuilder('e')
        .where('e.status IN (:...statuses)', {
          statuses: ['exported', 'transmitted', 'accepted'],
        })
        .getCount(),
      this.entries
        .createQueryBuilder('e')
        .where('e.status = :status', { status: 'rejected' })
        .getCount(),
      this.packets.count(),
      this.packets
        .createQueryBuilder('p')
        .where('p.status IN (:...statuses)', {
          statuses: ['extracted', 'reviewed', 'draft_created'],
        })
        .getCount(),
      this.suggestions.count(),
      this.suggestions
        .createQueryBuilder('s')
        .where('s.status IN (:...statuses)', {
          statuses: ['accepted', 'overridden'],
        })
        .getCount(),
      this.decisions.count(),
      this.decisions
        .createQueryBuilder('d')
        .where('d.licensedBrokerRequired = true')
        .getCount(),
      this.decisions
        .createQueryBuilder('d')
        .where('d.licensedBrokerRequired = true')
        .andWhere('d.licensedBrokerSatisfied = true')
        .getCount(),
    ]);

    const automationRate =
      suggestionsTotal > 0 ? suggestionsAccepted / suggestionsTotal : null;
    const licensedSatisfactionRate =
      licensedRequired > 0 ? licensedSatisfied / licensedRequired : null;

    return {
      entries: {
        total: entriesTotal,
        approvedOrLater: entriesApproved,
        exportedOrLater: entriesExported,
        rejected: entriesRejected,
      },
      packets: { total: packetsTotal, extracted: packetsExtracted },
      ai: {
        suggestionsTotal,
        suggestionsAccepted,
        automationRate,
      },
      governance: {
        decisionsTotal,
        licensedRequired,
        licensedSatisfied,
        licensedSatisfactionRate,
      },
    };
  }

  /**
   * Aggregate AI governance view used by /platform-admin/broker/ai-governance.
   * Returns the licensed-broker enforcement breakdown grouped by suggestion
   * type so admins can spot policy drift.
   */
  async aiGovernance() {
    const raw = await this.decisions
      .createQueryBuilder('d')
      .select('d.suggestionType', 'suggestionType')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        'SUM(CASE WHEN d.licensedBrokerRequired = true THEN 1 ELSE 0 END)',
        'required',
      )
      .addSelect(
        'SUM(CASE WHEN d.licensedBrokerRequired = true AND d.licensedBrokerSatisfied = true THEN 1 ELSE 0 END)',
        'satisfied',
      )
      .addSelect(
        'SUM(CASE WHEN d.decision = :accept THEN 1 ELSE 0 END)',
        'accepted',
      )
      .addSelect(
        'SUM(CASE WHEN d.decision = :reject THEN 1 ELSE 0 END)',
        'rejected',
      )
      .addSelect(
        'SUM(CASE WHEN d.decision = :override THEN 1 ELSE 0 END)',
        'overridden',
      )
      .setParameters({
        accept: 'accept',
        reject: 'reject',
        override: 'override',
      })
      .groupBy('d.suggestionType')
      .getRawMany<{
        suggestionType: string;
        total: string;
        required: string;
        satisfied: string;
        accepted: string;
        rejected: string;
        overridden: string;
      }>();

    return raw.map((r) => ({
      suggestionType: r.suggestionType,
      total: Number(r.total),
      required: Number(r.required),
      satisfied: Number(r.satisfied),
      accepted: Number(r.accepted),
      rejected: Number(r.rejected),
      overridden: Number(r.overridden),
      satisfactionRate:
        Number(r.required) > 0
          ? Number(r.satisfied) / Number(r.required)
          : null,
    }));
  }

  /**
   * Audit log feed for the admin UI. Filters by event type substring and
   * organization id to keep payloads scoped.
   */
  async auditFeed(params: {
    eventTypeContains?: string;
    organizationId?: string;
    limit?: number;
  }) {
    const limit = params.limit ?? 100;
    const qb = this.audits
      .createQueryBuilder('a')
      .orderBy('a.createdAt', 'DESC')
      .take(limit);
    if (params.eventTypeContains) {
      qb.andWhere('a.eventType ILIKE :pattern', {
        pattern: `%${params.eventTypeContains}%`,
      });
    }
    if (params.organizationId) {
      qb.andWhere('a.organizationId = :orgId', {
        orgId: params.organizationId,
      });
    }
    return qb.getMany();
  }
}
