import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceBrokerProfileEntity } from '../../marketplace/entities';
import {
  MarketplaceBrokerMatchEntity,
  MarketplaceQuoteEntity,
} from '../../marketplace-requests/entities';
import { MarketplaceReviewEntity } from '../entities/marketplace-review.entity';
import { BrokerPerformanceSnapshotEntity } from '../entities/broker-performance-snapshot.entity';

@Injectable()
export class BrokerPerformanceService {
  constructor(
    @InjectRepository(MarketplaceBrokerProfileEntity)
    private readonly profiles: Repository<MarketplaceBrokerProfileEntity>,
    @InjectRepository(MarketplaceBrokerMatchEntity)
    private readonly matches: Repository<MarketplaceBrokerMatchEntity>,
    @InjectRepository(MarketplaceQuoteEntity)
    private readonly quotes: Repository<MarketplaceQuoteEntity>,
    @InjectRepository(MarketplaceReviewEntity)
    private readonly reviews: Repository<MarketplaceReviewEntity>,
    @InjectRepository(BrokerPerformanceSnapshotEntity)
    private readonly snapshots: Repository<BrokerPerformanceSnapshotEntity>,
  ) {}

  async snapshotForBroker(
    brokerProfileId: string,
    asOf: Date = new Date(),
  ): Promise<BrokerPerformanceSnapshotEntity> {
    const profile = await this.profiles.findOne({
      where: { id: brokerProfileId },
    });
    if (!profile) {
      throw new Error(`Profile ${brokerProfileId} not found`);
    }

    const allMatches = await this.matches.find({
      where: { brokerProfileId },
    });
    const allQuotes = await this.quotes.find({
      where: { brokerProfileId },
    });
    const approvedReviews = await this.reviews.find({
      where: { brokerProfileId, moderationStatus: 'approved' },
    });

    const leadsNotified = allMatches.length;
    const leadsViewed = allMatches.filter(
      (m) => m.status === 'viewed' || m.status === 'quoted' || m.status === 'selected',
    ).length;
    const quotesSubmitted = allQuotes.filter(
      (q) => q.status !== 'draft' && q.status !== 'withdrawn',
    ).length;
    const quotesAccepted = allQuotes.filter((q) => q.status === 'accepted').length;
    const completedEngagements = quotesAccepted;

    const responseRate =
      leadsNotified > 0 ? leadsViewed / leadsNotified : null;
    const quoteRate =
      leadsViewed > 0 ? quotesSubmitted / leadsViewed : null;
    const closeRate =
      quotesSubmitted > 0 ? quotesAccepted / quotesSubmitted : null;
    const averageRating =
      approvedReviews.length > 0
        ? approvedReviews.reduce((sum, r) => sum + r.rating, 0) /
          approvedReviews.length
        : null;

    const snapshotDate = asOf.toISOString().slice(0, 10);
    const existing = await this.snapshots.findOne({
      where: { brokerProfileId, snapshotDate },
    });

    const entity = this.snapshots.create({
      ...(existing ?? {}),
      brokerProfileId,
      brokerOrganizationId: profile.organizationId,
      snapshotDate,
      leadsNotified,
      leadsViewed,
      quotesSubmitted,
      quotesAccepted,
      responseRate: responseRate != null ? responseRate.toFixed(4) : null,
      quoteRate: quoteRate != null ? quoteRate.toFixed(4) : null,
      closeRate: closeRate != null ? closeRate.toFixed(4) : null,
      averageRating: averageRating != null ? averageRating.toFixed(2) : null,
      completedEngagements,
    });
    return this.snapshots.save(entity);
  }

  async snapshotAll(asOf: Date = new Date()): Promise<number> {
    const profiles = await this.profiles.find({
      where: { status: 'published' },
    });
    let count = 0;
    for (const profile of profiles) {
      await this.snapshotForBroker(profile.id, asOf);
      count += 1;
    }
    return count;
  }

  async latestForBroker(brokerProfileId: string) {
    return this.snapshots.findOne({
      where: { brokerProfileId },
      order: { snapshotDate: 'DESC' },
    });
  }

  async historyForBroker(brokerProfileId: string, days = 30) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return this.snapshots
      .createQueryBuilder('snap')
      .where('snap.brokerProfileId = :id', { id: brokerProfileId })
      .andWhere('snap.snapshotDate >= :cutoff', { cutoff })
      .orderBy('snap.snapshotDate', 'ASC')
      .getMany();
  }

  /**
   * Adjusts a broker match score by their verified quality signal.
   * Used by sponsored placement to gate sponsorship by relevance floor.
   */
  async qualityAdjustedRank(brokerProfileId: string, baseScore: number) {
    const snap = await this.latestForBroker(brokerProfileId);
    if (!snap) return baseScore;
    const responseRate = Number(snap.responseRate ?? 0);
    const closeRate = Number(snap.closeRate ?? 0);
    const adjustment = responseRate * 5 + closeRate * 10;
    return Math.min(100, baseScore + adjustment);
  }
}
