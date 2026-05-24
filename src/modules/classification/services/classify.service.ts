import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClassificationService as InnerClassificationService } from '../../lookup/services/classification.service';
import {
  ClassificationCandidateEntity,
  ClassificationEntity,
  CatalogService,
} from '../../catalog';
import { ClassifyRequestDto } from '../dto/classify.dto';

export interface ClassifyResponse {
  classificationId: string;
  candidates: Array<{
    hs6: string;
    destinationCode: string;
    confidence: number;
    rationale: string;
    rank: number;
  }>;
  recommended: { hs6: string; destinationCode: string; confidence: number };
  reviewRequired: boolean;
  modelVersion: string;
  featuresUsed: string[];
  fromCatalog: boolean;
}

/**
 * ClassifyService - P2.1.
 *
 * Wraps the existing lookup-module classifier and adds:
 *   - catalog-first lookup (skip re-classify if a confirmed
 *     ClassificationEntity exists for this product+destination)
 *   - persistence of returned candidates as ClassificationCandidateEntity
 *     rows when a productId is supplied
 */
@Injectable()
export class ClassifyService {
  private readonly logger = new Logger(ClassifyService.name);
  private readonly DEFAULT_REVIEW_THRESHOLD = 0.62;
  private readonly MODEL_VERSION = 'lookup-classifier@2026-05-23';

  constructor(
    private readonly inner: InnerClassificationService,
    private readonly catalog: CatalogService,
    @InjectRepository(ClassificationCandidateEntity)
    private readonly candidateRepo: Repository<ClassificationCandidateEntity>,
    @InjectRepository(ClassificationEntity)
    private readonly classificationRepo: Repository<ClassificationEntity>,
  ) {}

  async classify(
    organizationId: string,
    dto: ClassifyRequestDto,
  ): Promise<ClassifyResponse> {
    const destination = (dto.destinationCountry || 'US').toUpperCase();

    // Catalog-first fast path.
    if (dto.productId) {
      const stored = await this.catalog.findFreshClassification(
        dto.productId,
        destination,
      );
      if (stored) {
        return {
          classificationId: stored.id,
          candidates: [
            {
              hs6: stored.hs6,
              destinationCode: stored.destinationCode,
              confidence: Number(stored.confidence),
              rationale: 'Confirmed catalog classification',
              rank: 1,
            },
          ],
          recommended: {
            hs6: stored.hs6,
            destinationCode: stored.destinationCode,
            confidence: Number(stored.confidence),
          },
          reviewRequired: false,
          modelVersion: stored.modelVersion || this.MODEL_VERSION,
          featuresUsed: stored.featuresUsed || ['catalog'],
          fromCatalog: true,
        };
      }
    }

    const composed = [dto.name, dto.description, dto.category]
      .filter((s) => !!s)
      .join('. ');

    const innerResult = await this.inner.classifyProduct(
      composed,
      organizationId,
      dto.imageUrl
        ? {
            inputMethod: 'IMAGE_URL',
            sourceImageUrl: dto.imageUrl,
          }
        : { inputMethod: 'TEXT' },
    );

    const recommendedHs = innerResult.htsCode;
    const recommendedHs6 = recommendedHs?.replace(/\D/g, '').slice(0, 6) ?? '';

    const candidates = (innerResult.candidates || []).map((c, i) => ({
      hs6: (c.htsCode || '').replace(/\D/g, '').slice(0, 6),
      destinationCode: c.htsCode || '',
      confidence: Number(c.score ?? 0),
      rationale: c.description || '',
      rank: i + 1,
    }));

    // Persist candidates against the catalog product if linked.
    if (dto.productId) {
      const now = new Date();
      const rows = candidates.map((c) =>
        this.candidateRepo.create({
          productId: dto.productId!,
          destinationJurisdictionCode: destination,
          hs6: c.hs6,
          destinationCode: c.destinationCode,
          confidence: c.confidence,
          rationale: c.rationale,
          rank: c.rank,
          producedAt: now,
          producedBy: this.MODEL_VERSION,
        }),
      );
      if (rows.length > 0) {
        await this.candidateRepo.save(rows);
      }
    }

    return {
      classificationId:
        innerResult.id || `classify-${Date.now()}`,
      candidates,
      recommended: {
        hs6: recommendedHs6,
        destinationCode: recommendedHs,
        confidence: Number(innerResult.confidence ?? 0),
      },
      reviewRequired:
        !!innerResult.needsReview ||
        Number(innerResult.confidence ?? 0) < this.DEFAULT_REVIEW_THRESHOLD,
      modelVersion: this.MODEL_VERSION,
      featuresUsed: ['text', dto.imageUrl ? 'image' : null].filter(
        Boolean,
      ) as string[],
      fromCatalog: false,
    };
  }
}
