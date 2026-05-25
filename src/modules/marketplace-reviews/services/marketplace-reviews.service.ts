import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import {
  MarketplaceQuoteEntity,
  MarketplaceRequestEntity,
} from '../../marketplace-requests/entities';
import {
  CreateReviewDto,
  ListReviewsDto,
  ModerateReviewDto,
} from '../dto/marketplace-reviews.dto';
import { MarketplaceReviewEntity } from '../entities';

@Injectable()
export class MarketplaceReviewsService {
  constructor(
    @InjectRepository(MarketplaceReviewEntity)
    private readonly reviews: Repository<MarketplaceReviewEntity>,
    @InjectRepository(MarketplaceRequestEntity)
    private readonly requests: Repository<MarketplaceRequestEntity>,
    @InjectRepository(MarketplaceQuoteEntity)
    private readonly quotes: Repository<MarketplaceQuoteEntity>,
    private readonly audit: AuditService,
  ) {}

  async createReview(ctx: RequestContext, dto: CreateReviewDto) {
    this.assertAuthenticated(ctx);
    const request = await this.requests.findOne({
      where: { id: dto.requestId },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.requestingOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Only the requester can leave a review');
    }
    if (
      request.status !== 'broker_selected' &&
      request.status !== 'closed'
    ) {
      throw new BadRequestException(
        'Reviews are only allowed after a broker is selected or the request is closed',
      );
    }
    if (!request.selectedBrokerProfileId || !request.selectedQuoteId) {
      throw new BadRequestException(
        'Reviews require a completed engagement (selected quote)',
      );
    }
    const quote = await this.quotes.findOne({
      where: { id: request.selectedQuoteId },
    });
    if (!quote) throw new NotFoundException('Selected quote not found');

    const existing = await this.reviews.findOne({
      where: { requestId: request.id },
    });
    if (existing) {
      throw new BadRequestException(
        'A review for this request already exists',
      );
    }

    const review = this.reviews.create({
      requestId: request.id,
      brokerProfileId: request.selectedBrokerProfileId,
      brokerOrganizationId: quote.brokerOrganizationId,
      reviewerOrganizationId: ctx.organizationId,
      reviewerUserId: ctx.userId,
      rating: dto.rating,
      tags: dto.tags ?? [],
      comment: dto.comment ?? null,
      moderationStatus: 'pending',
    });
    const saved = await this.reviews.save(review);

    await this.audit.record({
      eventType: 'marketplace_reviews.review.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_review',
      resourceId: saved.id,
      source: 'marketplace-reviews',
    });
    return saved;
  }

  async listForBroker(brokerProfileId: string, dto: ListReviewsDto) {
    const limit = dto.limit ?? 20;
    const offset = dto.offset ?? 0;
    const qb = this.reviews
      .createQueryBuilder('review')
      .where('review.brokerProfileId = :brokerProfileId', { brokerProfileId })
      .andWhere('review.moderationStatus = :status', {
        status: dto.moderationStatus ?? 'approved',
      })
      .orderBy('review.createdAt', 'DESC')
      .take(limit)
      .skip(offset);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total, limit, offset };
  }

  async listForModeration(dto: ListReviewsDto) {
    const limit = dto.limit ?? 25;
    const offset = dto.offset ?? 0;
    const qb = this.reviews
      .createQueryBuilder('review')
      .where('review.moderationStatus = :status', {
        status: dto.moderationStatus ?? 'pending',
      })
      .orderBy('review.createdAt', 'DESC')
      .take(limit)
      .skip(offset);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total, limit, offset };
  }

  async moderate(
    ctx: RequestContext,
    reviewId: string,
    dto: ModerateReviewDto,
  ) {
    this.assertAuthenticated(ctx);
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    review.moderationStatus = dto.status;
    review.moderatedAt = new Date();
    review.moderatedByUserId = ctx.userId;
    review.moderationNote = dto.note ?? null;
    const saved = await this.reviews.save(review);
    await this.audit.record({
      eventType: 'marketplace_reviews.review.moderated',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_review',
      resourceId: saved.id,
      source: 'admin',
      metadata: { status: saved.moderationStatus, note: dto.note ?? null },
    });
    return saved;
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }
}
