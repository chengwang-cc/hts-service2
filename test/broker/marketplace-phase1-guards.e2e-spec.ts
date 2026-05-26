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
import type { MarketplaceBrokerProfileEntity } from '../../src/modules/marketplace/entities';

function baseRequest(
  overrides: Partial<MarketplaceRequestEntity> = {},
): MarketplaceRequestEntity {
  return {
    id: 'req-1',
    requestingOrganizationId: ctx.organizationId,
    requestingUserId: ctx.userId,
    status: 'open',
    requestType: 'one_time',
    title: 'Classification support',
    commoditySummary: 'Cotton t-shirts for retail sale',
    originCountry: 'VN',
    destinationCountry: 'US',
    portOfEntry: 'USLAX',
    mode: 'ocean',
    candidateHtsNumbers: ['6109.10.0012'],
    regulatoryFlags: ['TEXTILE'],
    serviceCategories: ['classification'],
    shipmentValue: '10000',
    shipmentCurrency: 'USD',
    shipmentVolume: { units: 100 },
    readinessScore: 82,
    readinessBreakdown: { documents: 80 },
    visibilityMode: 'invited',
    deadline: null,
    selectedBrokerProfileId: null,
    selectedQuoteId: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as MarketplaceRequestEntity;
}

function profile(
  overrides: Partial<MarketplaceBrokerProfileEntity> = {},
): MarketplaceBrokerProfileEntity {
  return {
    id: 'profile-1',
    organizationId: 'broker-org-1',
    ownerUserId: 'broker-user-1',
    companyName: 'Broker Co',
    slug: 'broker-co',
    status: 'published',
    verificationStatus: 'verified',
    countries: ['US'],
    ports: ['USLAX'],
    serviceCategories: ['classification'],
    shipmentModes: ['ocean'],
    languages: ['en'],
    specialties: [],
    complianceBadges: [],
    aiCapabilities: null,
    metrics: null,
    tagline: null,
    description: null,
    websiteUrl: null,
    contactEmail: null,
    contactPhone: null,
    officeAddress: null,
    minimumEngagement: null,
    searchKeywords: null,
    submittedForVerificationAt: null,
    verifiedAt: null,
    verifiedByUserId: null,
    publishedAt: new Date(),
    suspendedAt: null,
    moderationNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as MarketplaceBrokerProfileEntity;
}

function build(
  seed: {
    requests?: MarketplaceRequestEntity[];
    matches?: MarketplaceBrokerMatchEntity[];
    conversations?: MarketplaceConversationEntity[];
    messages?: MarketplaceMessageEntity[];
    profiles?: MarketplaceBrokerProfileEntity[];
  } = {},
) {
  const requests = createRepoMock<MarketplaceRequestEntity>(
    seed.requests ?? [],
  );
  const quotes = createRepoMock<MarketplaceQuoteEntity>();
  const matches = createRepoMock<MarketplaceBrokerMatchEntity>(
    seed.matches ?? [],
  );
  const conversations = createRepoMock<MarketplaceConversationEntity>(
    seed.conversations ?? [],
  );
  const messages = createRepoMock<MarketplaceMessageEntity>(
    seed.messages ?? [],
  );
  const profiles = createRepoMock<MarketplaceBrokerProfileEntity>(
    seed.profiles ?? [],
  );
  const matching = {
    matchRequest: jest.fn(async () => []),
    listForBroker: jest.fn(async () => []),
    listForRequest: jest.fn(async () => []),
    markViewed: jest.fn(),
    decline: jest.fn(),
    inviteSpecificBrokers: jest.fn(
      async (
        request: MarketplaceRequestEntity,
        ids: string[],
      ): Promise<MarketplaceBrokerMatchEntity[]> =>
        ids.map(
          (id) =>
            ({
              id: `match-${id}`,
              requestId: request.id,
              brokerProfileId: id,
              brokerOrganizationId: `org-${id}`,
              status: 'invited',
            }) as unknown as MarketplaceBrokerMatchEntity,
        ),
    ),
    allPublishedProfiles: jest.fn(async () => []),
  };
  const svc = new MarketplaceRequestsService(
    requests as any,
    quotes as any,
    matches as any,
    conversations as any,
    messages as any,
    createRepoMock<BrokerClientEntity>() as any,
    createRepoMock<OrganizationEntity>() as any,
    {
      preflight: jest.fn(async () => ({
        candidateHtsNumbers: ['6109.10.0012'],
        regulatoryFlags: ['TEXTILE'],
        readinessScore: 82,
        readinessBreakdown: { documents: 80 },
      })),
    } as any,
    matching as any,
    { create: jest.fn() } as any,
    { draftFromHandoff: jest.fn() } as any,
    createAuditMock(),
    {
      keyBelongsToTenant: () => true,
      createReadUrl: jest.fn(),
      providerKey: 'mock',
    } as any,
    null,
    null,
    profiles as any,
  );
  return {
    svc,
    requests,
    matches,
    conversations,
    messages,
    profiles,
    matching,
  };
}

describe('Marketplace Phase 1 guards', () => {
  it('defaults new requests to invite-only without broad broker matching', async () => {
    const { svc, requests, matching } = build();

    const created = await svc.create(ctx, {
      commoditySummary: 'Cotton shirts',
      serviceCategories: ['classification'],
    } as any);

    expect(created.visibilityMode).toBe('invited');
    expect(matching.matchRequest).not.toHaveBeenCalled();
    expect(matching.inviteSpecificBrokers).not.toHaveBeenCalled();
    expect(requests.__store[0].metadata).toEqual(
      expect.objectContaining({
        visibilityDecision: expect.objectContaining({
          mode: 'invited',
          createdMatchCount: 0,
        }),
      }),
    );
  });

  it('deduplicates invited brokers and validates that profiles are published and verified', async () => {
    const { svc, matching } = build({
      profiles: [profile({ id: 'profile-1' })],
    });

    await svc.create(ctx, {
      commoditySummary: 'Cotton shirts',
      serviceCategories: ['classification'],
      visibilityMode: 'invited',
      invitedBrokerProfileIds: ['profile-1', 'profile-1'],
    } as any);

    expect(matching.inviteSpecificBrokers).toHaveBeenCalledWith(
      expect.objectContaining({ visibilityMode: 'invited' }),
      ['profile-1'],
    );
  });

  it('rejects invited profiles that are not published and verified', async () => {
    const { svc } = build({
      profiles: [
        profile({ id: 'pending-profile', verificationStatus: 'pending' }),
      ],
    });

    await expect(
      svc.create(ctx, {
        commoditySummary: 'Cotton shirts',
        serviceCategories: ['classification'],
        visibilityMode: 'invited',
        invitedBrokerProfileIds: ['pending-profile'],
      } as any),
    ).rejects.toThrow(/not published and verified/i);
  });

  it('prevents brokers from listing another broker profile conversation', async () => {
    const brokerCtx = { ...ctx, organizationId: 'broker-org-1' };
    const { svc } = build({
      requests: [baseRequest()],
      matches: [
        {
          id: 'match-1',
          requestId: 'req-1',
          brokerProfileId: 'profile-1',
          brokerOrganizationId: 'broker-org-1',
          status: 'invited',
        } as unknown as MarketplaceBrokerMatchEntity,
      ],
    });

    await expect(
      svc.listMessagesForRequest(brokerCtx, 'req-1', 'profile-2'),
    ).rejects.toThrow(/not a participant/i);
  });

  it('shows brokers only a minimized request preview until full-packet consent', async () => {
    const request = baseRequest();
    const match = {
      id: 'match-1',
      requestId: request.id,
      brokerProfileId: 'profile-1',
      brokerOrganizationId: 'broker-org-1',
      status: 'invited',
    } as unknown as MarketplaceBrokerMatchEntity;
    const { svc, matching } = build({ requests: [request] });
    (matching.listForBroker as jest.Mock).mockResolvedValue([match]);

    const leads = await svc.listBrokerLeads({
      ...ctx,
      organizationId: 'broker-org-1',
    });

    expect(leads[0].request).toEqual(
      expect.objectContaining({
        portOfEntry: null,
        regulatoryFlags: [],
        candidateHtsNumbers: [],
        candidateHtsChapters: ['61'],
        readinessBreakdown: null,
        shipmentValue: null,
        detailLevel: 'matched_preview',
      }),
    );
  });
});
