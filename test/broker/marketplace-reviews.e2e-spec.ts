import { MarketplaceReviewsService } from '../../src/modules/marketplace-reviews/services/marketplace-reviews.service';
import { createAuditMock, createRepoMock, ctx } from './helpers';
import type {
  MarketplaceQuoteEntity,
  MarketplaceRequestEntity,
} from '../../src/modules/marketplace-requests/entities';
import type { MarketplaceReviewEntity } from '../../src/modules/marketplace-reviews/entities';

function build(seed: {
  requests?: Partial<MarketplaceRequestEntity>[];
  quotes?: Partial<MarketplaceQuoteEntity>[];
  reviews?: Partial<MarketplaceReviewEntity>[];
}) {
  const reviews = createRepoMock<MarketplaceReviewEntity>(
    seed.reviews as unknown as MarketplaceReviewEntity[] ?? [],
  );
  const requests = createRepoMock<MarketplaceRequestEntity>(
    seed.requests as unknown as MarketplaceRequestEntity[] ?? [],
  );
  const quotes = createRepoMock<MarketplaceQuoteEntity>(
    seed.quotes as unknown as MarketplaceQuoteEntity[] ?? [],
  );
  return {
    svc: new MarketplaceReviewsService(
      reviews as any,
      requests as any,
      quotes as any,
      createAuditMock(),
    ),
    reviews,
    requests,
    quotes,
  };
}

describe('MarketplaceReviewsService.createReview eligibility', () => {
  it('refuses review on an open (not broker-selected) request', async () => {
    const { svc } = build({
      requests: [
        {
          id: 'req-1',
          requestingOrganizationId: ctx.organizationId,
          status: 'open',
          selectedQuoteId: null,
          selectedBrokerProfileId: null,
        } as unknown as MarketplaceRequestEntity,
      ],
    });
    await expect(
      svc.createReview(ctx, { requestId: 'req-1', rating: 5 }),
    ).rejects.toThrow(/only allowed after/i);
  });

  it('refuses review on a request that has no selected quote', async () => {
    const { svc } = build({
      requests: [
        {
          id: 'req-1',
          requestingOrganizationId: ctx.organizationId,
          status: 'broker_selected',
          selectedQuoteId: null,
          selectedBrokerProfileId: null,
        } as unknown as MarketplaceRequestEntity,
      ],
    });
    await expect(
      svc.createReview(ctx, { requestId: 'req-1', rating: 5 }),
    ).rejects.toThrow(/completed engagement/i);
  });

  it('creates a pending review when engagement is broker_selected', async () => {
    const { svc, reviews } = build({
      requests: [
        {
          id: 'req-1',
          requestingOrganizationId: ctx.organizationId,
          status: 'broker_selected',
          selectedQuoteId: 'q1',
          selectedBrokerProfileId: 'bp1',
        } as unknown as MarketplaceRequestEntity,
      ],
      quotes: [
        {
          id: 'q1',
          requestId: 'req-1',
          brokerProfileId: 'bp1',
          brokerOrganizationId: 'org-broker',
          status: 'accepted',
        } as unknown as MarketplaceQuoteEntity,
      ],
    });
    const r = await svc.createReview(ctx, {
      requestId: 'req-1',
      rating: 5,
      comment: 'great',
    });
    expect(r.moderationStatus).toBe('pending');
    expect(reviews.__store).toHaveLength(1);
  });

  it('refuses duplicate review for same request', async () => {
    const { svc } = build({
      requests: [
        {
          id: 'req-1',
          requestingOrganizationId: ctx.organizationId,
          status: 'broker_selected',
          selectedQuoteId: 'q1',
          selectedBrokerProfileId: 'bp1',
        } as unknown as MarketplaceRequestEntity,
      ],
      quotes: [
        {
          id: 'q1',
          requestId: 'req-1',
          brokerProfileId: 'bp1',
          brokerOrganizationId: 'o',
          status: 'accepted',
        } as unknown as MarketplaceQuoteEntity,
      ],
      reviews: [
        {
          id: 'r0',
          requestId: 'req-1',
          brokerProfileId: 'bp1',
          brokerOrganizationId: 'o',
          reviewerOrganizationId: ctx.organizationId,
          reviewerUserId: 'u',
          rating: 4,
          tags: [],
          comment: null,
          moderationStatus: 'approved',
        } as unknown as MarketplaceReviewEntity,
      ],
    });
    await expect(
      svc.createReview(ctx, { requestId: 'req-1', rating: 5 }),
    ).rejects.toThrow(/already exists/i);
  });

  it('listForBroker hides non-approved reviews by default', async () => {
    const { svc } = build({
      reviews: [
        {
          id: 'r1',
          brokerProfileId: 'bp1',
          moderationStatus: 'approved',
        } as unknown as MarketplaceReviewEntity,
        {
          id: 'r2',
          brokerProfileId: 'bp1',
          moderationStatus: 'hidden',
        } as unknown as MarketplaceReviewEntity,
      ],
    });
    const { rows } = await svc.listForBroker('bp1', {});
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('r1');
  });
});
