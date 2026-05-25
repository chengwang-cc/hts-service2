import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceBrokerProfileEntity } from '../../marketplace/entities';
import {
  MarketplaceBrokerMatchEntity,
  MarketplaceRequestEntity,
} from '../entities';

interface MatchCandidate {
  profile: MarketplaceBrokerProfileEntity;
  score: number;
  breakdown: MarketplaceBrokerMatchEntity['scoreBreakdown'];
  reasons: MarketplaceBrokerMatchEntity['reasons'];
  gaps: string[];
}

@Injectable()
export class BrokerMatchingService {
  constructor(
    @InjectRepository(MarketplaceBrokerProfileEntity)
    private readonly profiles: Repository<MarketplaceBrokerProfileEntity>,
    @InjectRepository(MarketplaceBrokerMatchEntity)
    private readonly matches: Repository<MarketplaceBrokerMatchEntity>,
  ) {}

  async matchRequest(request: MarketplaceRequestEntity, limit = 10) {
    const candidates = await this.profiles.find({
      where: { status: 'published', verificationStatus: 'verified' },
      take: 200,
    });

    const scored: MatchCandidate[] = candidates
      .map((profile) => this.score(profile, request))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // R2-D-03 — sponsored placement. Up to N Pro brokers whose
    // qualityAdjustedRank meets the floor get pinned to the top of the
    // match list; the reason list is annotated with `sponsored=true` so
    // the UI can render the disclosure label.
    const sponsoredSlots = Number(
      process.env.MARKETPLACE_SPONSORED_SLOTS || 1,
    );
    const sponsoredFloor = Number(
      process.env.MARKETPLACE_SPONSORED_RANK_FLOOR || 80,
    );
    const sponsoredIds = new Set<string>();
    if (sponsoredSlots > 0) {
      const eligible = scored
        .filter((c) => c.profile.tier === 'pro')
        .filter((c) => {
          const rank = Number(c.profile.qualityAdjustedRank ?? 0);
          return rank >= sponsoredFloor;
        })
        .slice(0, sponsoredSlots);
      for (const e of eligible) sponsoredIds.add(e.profile.id);
    }

    // Re-order: sponsored first (preserving their relative score order),
    // organic second.
    scored.sort((a, b) => {
      const aSp = sponsoredIds.has(a.profile.id) ? 1 : 0;
      const bSp = sponsoredIds.has(b.profile.id) ? 1 : 0;
      if (aSp !== bSp) return bSp - aSp;
      return b.score - a.score;
    });

    const persisted: MarketplaceBrokerMatchEntity[] = [];
    for (const candidate of scored) {
      const existing = await this.matches.findOne({
        where: {
          requestId: request.id,
          brokerProfileId: candidate.profile.id,
        },
      });
      const sponsored = sponsoredIds.has(candidate.profile.id);
      const reasons = sponsored
        ? [
            ...(candidate.reasons ?? []),
            {
              code: 'SPONSORED_PLACEMENT',
              detail: `Sponsored placement (Pro tier, quality rank ${candidate.profile.qualityAdjustedRank ?? '?'}). Ranking disclosed per FTC guidance.`,
              verified: true,
            },
          ]
        : candidate.reasons;
      const match = this.matches.create({
        ...(existing ?? {}),
        requestId: request.id,
        brokerProfileId: candidate.profile.id,
        brokerOrganizationId: candidate.profile.organizationId,
        matchScore: candidate.score.toFixed(2),
        scoreBreakdown: candidate.breakdown,
        reasons,
        gaps: candidate.gaps,
        status: existing?.status ?? 'notified',
      });
      persisted.push(await this.matches.save(match));
    }
    return persisted;
  }

  async listForRequest(requestId: string) {
    const matches = await this.matches.find({
      where: { requestId },
      order: { matchScore: 'DESC' },
    });

    if (!matches.length) return [];
    const profileIds = matches.map((m) => m.brokerProfileId);
    const profiles = await this.profiles.find({
      where: profileIds.map((id) => ({ id })),
    });
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    return matches.map((match) => ({
      ...match,
      profile: profileById.get(match.brokerProfileId)
        ? this.profileSummary(profileById.get(match.brokerProfileId)!)
        : null,
    }));
  }

  async listForBroker(brokerOrganizationId: string) {
    const matches = await this.matches.find({
      where: { brokerOrganizationId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return matches;
  }

  async markViewed(matchId: string, brokerOrganizationId: string) {
    const match = await this.matches.findOne({ where: { id: matchId } });
    if (!match || match.brokerOrganizationId !== brokerOrganizationId) {
      return null;
    }
    if (match.status === 'notified') {
      match.status = 'viewed';
      match.viewedAt = new Date();
      await this.matches.save(match);
    }
    return match;
  }

  async decline(
    matchId: string,
    brokerOrganizationId: string,
    reason?: string,
  ) {
    const match = await this.matches.findOne({ where: { id: matchId } });
    if (!match || match.brokerOrganizationId !== brokerOrganizationId) {
      return null;
    }
    match.status = 'declined';
    match.declinedAt = new Date();
    match.declineReason = reason ?? null;
    return this.matches.save(match);
  }

  async inviteSpecificBrokers(
    request: MarketplaceRequestEntity,
    brokerProfileIds: string[],
  ): Promise<MarketplaceBrokerMatchEntity[]> {
    const profiles = await this.profiles.find({
      where: brokerProfileIds.map((id) => ({ id })),
    });
    const created: MarketplaceBrokerMatchEntity[] = [];
    for (const profile of profiles) {
      if (profile.verificationStatus !== 'verified') continue;
      const candidate = this.score(profile, request);
      const existing = await this.matches.findOne({
        where: { requestId: request.id, brokerProfileId: profile.id },
      });
      const match = this.matches.create({
        ...(existing ?? {}),
        requestId: request.id,
        brokerProfileId: profile.id,
        brokerOrganizationId: profile.organizationId,
        matchScore: candidate.score.toFixed(2),
        scoreBreakdown: candidate.breakdown,
        reasons: candidate.reasons,
        gaps: candidate.gaps,
        status: existing?.status === 'declined' ? 'notified' : existing?.status ?? 'notified',
      });
      created.push(await this.matches.save(match));
    }
    return created;
  }

  async allPublishedProfiles(): Promise<MarketplaceBrokerProfileEntity[]> {
    return this.profiles.find({
      where: { status: 'published', verificationStatus: 'verified' },
      take: 500,
    });
  }

  private score(
    profile: MarketplaceBrokerProfileEntity,
    request: MarketplaceRequestEntity,
  ): MatchCandidate {
    const reasons: NonNullable<MarketplaceBrokerMatchEntity['reasons']> = [];
    const gaps: string[] = [];

    const commodityScore = this.commodityScore(profile, request, reasons, gaps);
    const laneScore = this.laneScore(profile, request, reasons, gaps);
    const credentialScore = this.credentialScore(profile, reasons);
    const responsivenessScore = this.responsivenessScore(profile, reasons);
    const softwareScore = this.softwareScore(profile, reasons);
    const commercialScore = this.commercialScore(profile, request, reasons);

    const weighted =
      commodityScore * 0.35 +
      laneScore * 0.2 +
      credentialScore * 0.15 +
      responsivenessScore * 0.15 +
      softwareScore * 0.1 +
      commercialScore * 0.05;

    return {
      profile,
      score: Math.round(weighted * 100) / 100,
      breakdown: {
        commodity: Math.round(commodityScore),
        laneAndMode: Math.round(laneScore),
        credentials: Math.round(credentialScore),
        responsiveness: Math.round(responsivenessScore),
        software: Math.round(softwareScore),
        commercial: Math.round(commercialScore),
      },
      reasons,
      gaps,
    };
  }

  private commodityScore(
    profile: MarketplaceBrokerProfileEntity,
    request: MarketplaceRequestEntity,
    reasons: NonNullable<MarketplaceBrokerMatchEntity['reasons']>,
    gaps: string[],
  ): number {
    const specialties = (profile.specialties ?? []).map((s) =>
      s.toLowerCase(),
    );
    const services = (profile.serviceCategories ?? []).map((s) =>
      s.toLowerCase(),
    );
    const required = (request.serviceCategories ?? []).map((s) =>
      s.toLowerCase(),
    );
    const summary = (request.commoditySummary ?? '').toLowerCase();

    let score = 30;
    let matches = 0;
    for (const req of required) {
      if (services.includes(req)) {
        matches += 1;
        reasons.push({
          code: 'service_category_match',
          detail: `Offers ${req} service`,
          verified: true,
        });
      } else {
        gaps.push(`Broker does not list ${req} service`);
      }
    }
    if (required.length) {
      score += Math.min(40, (matches / required.length) * 60);
    }

    for (const specialty of specialties) {
      if (specialty && summary.includes(specialty)) {
        score += 10;
        reasons.push({
          code: 'commodity_specialty_match',
          detail: `Specialty in ${specialty}`,
        });
      }
    }

    for (const flag of request.regulatoryFlags ?? []) {
      const flagLower = flag.toLowerCase();
      if (specialties.some((s) => s.includes(flagLower))) {
        score += 5;
        reasons.push({
          code: 'regulatory_specialty',
          detail: `Handles ${flag}`,
        });
      } else {
        gaps.push(`No verified expertise for ${flag}`);
      }
    }

    return Math.min(100, score);
  }

  private laneScore(
    profile: MarketplaceBrokerProfileEntity,
    request: MarketplaceRequestEntity,
    reasons: NonNullable<MarketplaceBrokerMatchEntity['reasons']>,
    gaps: string[],
  ): number {
    let score = 40;
    const countries = (profile.countries ?? []).map((c) => c.toUpperCase());
    const ports = (profile.ports ?? []).map((p) => p.toUpperCase());
    const modes = (profile.shipmentModes ?? []).map((m) => m.toLowerCase());

    if (
      request.originCountry &&
      countries.includes(request.originCountry.toUpperCase())
    ) {
      score += 20;
      reasons.push({
        code: 'origin_country',
        detail: `Operates from ${request.originCountry}`,
      });
    } else if (request.originCountry) {
      gaps.push(`Origin ${request.originCountry} not listed`);
    }

    if (
      request.destinationCountry &&
      countries.includes(request.destinationCountry.toUpperCase())
    ) {
      score += 20;
      reasons.push({
        code: 'destination_country',
        detail: `Operates to ${request.destinationCountry}`,
      });
    }

    if (
      request.portOfEntry &&
      ports.includes(request.portOfEntry.toUpperCase())
    ) {
      score += 10;
      reasons.push({
        code: 'port_coverage',
        detail: `Covers port ${request.portOfEntry}`,
      });
    }

    if (request.mode && modes.includes(request.mode)) {
      score += 10;
      reasons.push({
        code: 'mode_match',
        detail: `Handles ${request.mode}`,
      });
    } else if (request.mode) {
      gaps.push(`Mode ${request.mode} not in listed shipment modes`);
    }

    return Math.min(100, score);
  }

  private credentialScore(
    profile: MarketplaceBrokerProfileEntity,
    reasons: NonNullable<MarketplaceBrokerMatchEntity['reasons']>,
  ): number {
    let score = 50;
    if (profile.verificationStatus === 'verified') {
      score += 30;
      reasons.push({
        code: 'verified_profile',
        detail: 'Profile is platform-verified',
        verified: true,
      });
    }
    if ((profile.complianceBadges ?? []).length > 0) {
      score += 20;
      reasons.push({
        code: 'compliance_badges',
        detail: `${profile.complianceBadges.length} compliance badge(s)`,
        verified: true,
      });
    }
    return Math.min(100, score);
  }

  private responsivenessScore(
    profile: MarketplaceBrokerProfileEntity,
    reasons: NonNullable<MarketplaceBrokerMatchEntity['reasons']>,
  ): number {
    const metrics = profile.metrics;
    if (!metrics) return 50;
    let score = 50;
    if (metrics.averageResponseHours != null) {
      if (metrics.averageResponseHours <= 4) {
        score = 95;
        reasons.push({
          code: 'fast_response',
          detail: `Avg response ${metrics.averageResponseHours}h`,
        });
      } else if (metrics.averageResponseHours <= 12) {
        score = 80;
      } else if (metrics.averageResponseHours <= 24) {
        score = 65;
      } else {
        score = 50;
      }
    }
    if (metrics.satisfactionScore != null) {
      score = Math.min(100, score + (metrics.satisfactionScore / 5) * 20);
    }
    return score;
  }

  private softwareScore(
    profile: MarketplaceBrokerProfileEntity,
    reasons: NonNullable<MarketplaceBrokerMatchEntity['reasons']>,
  ): number {
    const ai = profile.aiCapabilities;
    if (!ai) return 40;
    let score = 40;
    if (ai.supportsAiClassification) {
      score += 25;
      reasons.push({
        code: 'ai_classification',
        detail: 'AI classification supported',
      });
    }
    if (ai.supportsDocumentAutomation) {
      score += 20;
      reasons.push({
        code: 'document_automation',
        detail: 'Document automation supported',
      });
    }
    if (ai.supportsDutyAudit) {
      score += 15;
      reasons.push({
        code: 'duty_audit',
        detail: 'Duty audit supported',
      });
    }
    return Math.min(100, score);
  }

  private commercialScore(
    profile: MarketplaceBrokerProfileEntity,
    _request: MarketplaceRequestEntity,
    _reasons: NonNullable<MarketplaceBrokerMatchEntity['reasons']>,
  ): number {
    if (!profile.minimumEngagement) return 70;
    return 60;
  }

  private profileSummary(profile: MarketplaceBrokerProfileEntity) {
    return {
      id: profile.id,
      slug: profile.slug,
      companyName: profile.companyName,
      tagline: profile.tagline,
      countries: profile.countries,
      ports: profile.ports,
      serviceCategories: profile.serviceCategories,
      specialties: profile.specialties,
      verificationStatus: profile.verificationStatus,
      metrics: profile.metrics,
    };
  }
}
