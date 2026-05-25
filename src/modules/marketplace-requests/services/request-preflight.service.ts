import { Injectable, Logger } from '@nestjs/common';
import { CreateMarketplaceRequestDto } from '../dto/marketplace-requests.dto';

export interface PreflightResult {
  candidateHtsNumbers: string[];
  regulatoryFlags: string[];
  readinessScore: number;
  readinessBreakdown: {
    documents: { score: number; notes?: string };
    classification: { score: number; notes?: string };
    risk: { score: number; notes?: string };
  };
}

@Injectable()
export class RequestPreflightService {
  private readonly logger = new Logger(RequestPreflightService.name);

  async preflight(dto: CreateMarketplaceRequestDto): Promise<PreflightResult> {
    const candidates = await this.deriveCandidateHts(dto);
    const flags = this.detectRegulatoryFlags(dto, candidates);
    const breakdown = this.scoreReadiness(dto, candidates, flags);
    const readinessScore = Math.round(
      (breakdown.documents.score +
        breakdown.classification.score +
        breakdown.risk.score) /
        3,
    );

    return {
      candidateHtsNumbers: candidates,
      regulatoryFlags: flags,
      readinessScore,
      readinessBreakdown: breakdown,
    };
  }

  private async deriveCandidateHts(
    dto: CreateMarketplaceRequestDto,
  ): Promise<string[]> {
    if (dto.candidateHtsNumbers?.length) {
      return Array.from(
        new Set(dto.candidateHtsNumbers.map((c) => c.trim()).filter(Boolean)),
      );
    }

    const commodity = (dto.commoditySummary ?? '').toLowerCase();
    const heuristics: Array<{ keywords: string[]; hts: string }> = [
      { keywords: ['phone case', 'phone accessory'], hts: '3926.90' },
      { keywords: ['keychain'], hts: '7326.20' },
      { keywords: ['cotton t-shirt', 't-shirt'], hts: '6109.10' },
      { keywords: ['leather wallet', 'wallet'], hts: '4202.31' },
      { keywords: ['laptop bag', 'laptop case'], hts: '4202.92' },
      { keywords: ['sneaker', 'shoe'], hts: '6404.11' },
      { keywords: ['handbag'], hts: '4202.22' },
      { keywords: ['food supplement', 'dietary supplement'], hts: '2106.90' },
      { keywords: ['cosmetic'], hts: '3304.99' },
      { keywords: ['electric scooter'], hts: '8711.60' },
    ];

    const matched = new Set<string>();
    for (const item of heuristics) {
      if (item.keywords.some((kw) => commodity.includes(kw))) {
        matched.add(item.hts);
      }
    }
    return Array.from(matched);
  }

  private detectRegulatoryFlags(
    dto: CreateMarketplaceRequestDto,
    candidates: string[],
  ): string[] {
    const flags = new Set<string>();
    const commodity = (dto.commoditySummary ?? '').toLowerCase();

    if (/(supplement|cosmetic|food|drug|pharma|nutraceutical)/.test(commodity)) {
      flags.add('FDA');
    }
    if (/(wood|plant|seed|lumber|paper)/.test(commodity)) {
      flags.add('LACEY_ACT');
    }
    if (/(animal|meat|dairy|beef|pork|poultry|leather)/.test(commodity)) {
      flags.add('USDA');
    }
    if (/(chemical|pesticide|battery|paint)/.test(commodity)) {
      flags.add('EPA');
    }
    if (/(textile|cotton|fabric|apparel|garment|t-shirt|shirt|jeans)/.test(commodity)) {
      flags.add('TEXTILE');
    }
    if (/(steel|aluminum|metal)/.test(commodity)) {
      flags.add('SECTION_232');
    }
    if (dto.originCountry?.toUpperCase() === 'CN') {
      flags.add('SECTION_301');
      flags.add('CHAPTER_99');
    }
    for (const hts of candidates) {
      if (hts.startsWith('99')) flags.add('CHAPTER_99');
    }
    if ((dto.shipmentValue ?? 0) > 2500) {
      flags.add('FORMAL_ENTRY_LIKELY');
    }
    return Array.from(flags);
  }

  private scoreReadiness(
    dto: CreateMarketplaceRequestDto,
    candidates: string[],
    flags: string[],
  ) {
    const documents = {
      score: 0,
      notes: 'Add commercial invoice and packing list to improve readiness',
    };
    if ((dto.commoditySummary ?? '').length > 60) documents.score += 40;
    if (dto.shipmentValue && dto.shipmentValue > 0) documents.score += 30;
    if (dto.originCountry && dto.destinationCountry) documents.score += 30;

    const classification = {
      score: candidates.length > 0 ? 60 : 25,
      notes:
        candidates.length > 0
          ? 'Candidate HTS detected from commodity description'
          : 'Provide a more detailed commodity description to detect HTS',
    };
    if (candidates.length > 1) classification.score = 80;

    const risk = {
      score: 80,
      notes:
        flags.length > 0
          ? `Risk detected: ${flags.join(', ')}`
          : 'No special programs detected',
    };
    if (flags.includes('CHAPTER_99') || flags.includes('FDA')) {
      risk.score -= 20;
    }

    return {
      documents: {
        score: Math.min(100, documents.score),
        notes: documents.notes,
      },
      classification,
      risk: {
        score: Math.max(0, Math.min(100, risk.score)),
        notes: risk.notes,
      },
    };
  }
}
