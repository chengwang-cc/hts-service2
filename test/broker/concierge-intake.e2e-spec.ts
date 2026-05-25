import { BadRequestException } from '@nestjs/common';
import { MarketplaceRequestsService } from '../../src/modules/marketplace-requests/services/marketplace-requests.service';
import { createAuditMock, createRepoMock, ctx } from './helpers';
import type {
  MarketplaceBrokerMatchEntity,
  MarketplaceConversationEntity,
  MarketplaceMessageEntity,
  MarketplaceQuoteEntity,
  MarketplaceRequestEntity,
} from '../../src/modules/marketplace-requests/entities';
import type { BrokerClientEntity } from '../../src/modules/broker-core/entities/broker-client.entity';
import type { OrganizationEntity } from '../../src/modules/auth/entities/organization.entity';

function mockStorage() {
  return {
    keyBelongsToTenant: () => true,
    createReadUrl: jest.fn(),
    providerKey: 'mock',
  } as any;
}

function build(requestRows: MarketplaceRequestEntity[] = []) {
  const requests = createRepoMock<MarketplaceRequestEntity>(requestRows);
  const quotes = createRepoMock<MarketplaceQuoteEntity>();
  const matches = createRepoMock<MarketplaceBrokerMatchEntity>();
  const conversations = createRepoMock<MarketplaceConversationEntity>();
  const messages = createRepoMock<MarketplaceMessageEntity>();
  const clients = createRepoMock<BrokerClientEntity>();
  const orgs = createRepoMock<OrganizationEntity>();
  const matching = {
    matchRequest: jest.fn(),
    listForRequest: jest.fn(async () => []),
    markViewed: jest.fn(),
    decline: jest.fn(),
    inviteSpecificBrokers: jest.fn(),
    allPublishedProfiles: jest.fn(async () => []),
  };
  return {
    requests,
    matching,
    build: (stripe: any) =>
      new MarketplaceRequestsService(
        requests as any,
        quotes as any,
        matches as any,
        conversations as any,
        messages as any,
        clients as any,
        orgs as any,
        {
          preflight: jest.fn(async () => ({
            candidateHtsNumbers: [],
            regulatoryFlags: [],
            serviceCategories: [],
            readinessScore: 50,
            readinessBreakdown: {},
          })),
        } as any,
        matching as any,
        { create: jest.fn() } as any,
        { draftFromHandoff: jest.fn() } as any,
        createAuditMock(),
        mockStorage(),
        stripe,
      ),
  };
}

describe('R1-B-04: concierge intake (Stripe → admin queue)', () => {
  beforeAll(() => {
    process.env.STRIPE_CONCIERGE_PRICE_ID = 'price_test_concierge';
    process.env.MARKETPLACE_CONCIERGE_SUCCESS_URL =
      'http://test.local/success';
    process.env.MARKETPLACE_CONCIERGE_CANCEL_URL = 'http://test.local/cancel';
  });

  it('startConciergeIntake creates a draft request and returns a Stripe checkout URL', async () => {
    const checkout = {
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/cs_test_1',
    };
    const stripe = {
      createFlexibleCheckoutSession: jest.fn(async () => checkout),
    };
    const { build: buildSvc, requests } = build([]);
    const svc = buildSvc(stripe);
    const result = await svc.startConciergeIntake(ctx, {
      commoditySummary: 'Aluminum window frames, 500 units',
    });
    expect(result.checkoutUrl).toBe(checkout.url);
    expect(result.sessionId).toBe(checkout.id);
    expect(requests.__store).toHaveLength(1);
    const draft = requests.__store[0];
    expect(draft.status).toBe('draft');
    expect(draft.priority).toBe('standard'); // promoted only after payment
    expect(stripe.createFlexibleCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        client_reference_id: draft.id,
        metadata: expect.objectContaining({ flow: 'concierge_intake' }),
      }),
    );
  });

  it('refuses startConciergeIntake when STRIPE_CONCIERGE_PRICE_ID is missing', async () => {
    const original = process.env.STRIPE_CONCIERGE_PRICE_ID;
    delete process.env.STRIPE_CONCIERGE_PRICE_ID;
    try {
      const svc = build([]).build({
        createFlexibleCheckoutSession: jest.fn(),
      });
      await expect(
        svc.startConciergeIntake(ctx, { commoditySummary: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      process.env.STRIPE_CONCIERGE_PRICE_ID = original;
    }
  });

  it('promoteConciergeRequest flips priority and reopens draft to open', async () => {
    const draft = {
      id: 'req-pre-paid',
      requestingOrganizationId: ctx.organizationId,
      requestingUserId: ctx.userId,
      status: 'draft',
      priority: 'standard',
      requestType: 'one_time',
      candidateHtsNumbers: [],
      regulatoryFlags: [],
      serviceCategories: [],
    } as unknown as MarketplaceRequestEntity;
    const { build: buildSvc, requests, matching } = build([draft]);
    const svc = buildSvc({ createFlexibleCheckoutSession: jest.fn() });
    const result = await svc.promoteConciergeRequest('req-pre-paid', 'pi_42');
    expect(result.priority).toBe('concierge');
    expect(result.status).toBe('open');
    expect(result.conciergePaymentIntentId).toBe('pi_42');
    expect(matching.matchRequest).toHaveBeenCalled();
    expect(requests.__store[0].priority).toBe('concierge');
  });

  it('promoteConciergeRequest is idempotent across webhook redelivery', async () => {
    const draft = {
      id: 'req-already-paid',
      requestingOrganizationId: ctx.organizationId,
      requestingUserId: ctx.userId,
      status: 'open',
      priority: 'concierge',
      conciergePaymentIntentId: 'pi_42',
      requestType: 'one_time',
      candidateHtsNumbers: [],
      regulatoryFlags: [],
      serviceCategories: [],
    } as unknown as MarketplaceRequestEntity;
    const { build: buildSvc, matching } = build([draft]);
    const svc = buildSvc({ createFlexibleCheckoutSession: jest.fn() });
    const result = await svc.promoteConciergeRequest('req-already-paid', 'pi_42');
    expect(result.priority).toBe('concierge');
    expect(matching.matchRequest).not.toHaveBeenCalled();
  });
});
