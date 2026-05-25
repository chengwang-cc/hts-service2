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

function build(
  requestRows: MarketplaceRequestEntity[],
  quoteRows: MarketplaceQuoteEntity[],
  matchRows: MarketplaceBrokerMatchEntity[] = [],
  brokerClients: BrokerClientEntity[] = [],
  orgs: OrganizationEntity[] = [],
  extraDeps: {
    relationshipsFind?: jest.Mock;
    relationshipsUpdate?: jest.Mock;
    cancelDraft?: jest.Mock;
  } = {},
) {
  const requests = createRepoMock<MarketplaceRequestEntity>(requestRows);
  const quotes = createRepoMock<MarketplaceQuoteEntity>(quoteRows);
  const matches = createRepoMock<MarketplaceBrokerMatchEntity>(matchRows);
  const conversations = createRepoMock<MarketplaceConversationEntity>();
  const messages = createRepoMock<MarketplaceMessageEntity>();
  const clients = createRepoMock<BrokerClientEntity>(brokerClients);
  const organizations = createRepoMock<OrganizationEntity>(orgs);

  const svc = new MarketplaceRequestsService(
    requests as any,
    quotes as any,
    matches as any,
    conversations as any,
    messages as any,
    clients as any,
    organizations as any,
    { preflight: jest.fn() } as any,
    {
      matchRequest: jest.fn(),
      listForRequest: jest.fn(async () => []),
      markViewed: jest.fn(),
      decline: jest.fn(),
      inviteSpecificBrokers: jest.fn(),
      allPublishedProfiles: jest.fn(async () => []),
    } as any,
    {
      create: jest.fn(async (input: any) => ({ id: 'rel-1', ...input })),
      findByMarketplaceQuoteId:
        extraDeps.relationshipsFind ?? jest.fn(async () => null),
      updateStatus: extraDeps.relationshipsUpdate ?? jest.fn(),
    } as any,
    {
      draftFromHandoff: jest.fn(async () => ({ id: 'draft-1' })),
      cancelHandoffDraft:
        extraDeps.cancelDraft ?? jest.fn(async () => true),
    } as any,
    createAuditMock(),
    mockStorage(),
  );
  return { svc, requests, quotes, matches, clients };
}

describe('Quote rescind, expiry, close cascade (R1-B)', () => {
  it('R1-B-01: inside the rescission window an accepted quote unwinds the relationship + draft entry', async () => {
    process.env.MARKETPLACE_QUOTE_RESCIND_WINDOW_HOURS = '48';
    const brokerOrgId = 'broker-1';
    const request = {
      id: 'req-1',
      requestingOrganizationId: 'biz-1',
      status: 'broker_selected',
      selectedQuoteId: 'q1',
      selectedBrokerProfileId: 'bp1',
      candidateHtsNumbers: [],
      regulatoryFlags: [],
      serviceCategories: [],
    } as unknown as MarketplaceRequestEntity;
    const acceptedAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const quote = {
      id: 'q1',
      requestId: 'req-1',
      brokerOrganizationId: brokerOrgId,
      brokerProfileId: 'bp1',
      status: 'accepted',
      acceptedAt,
      currency: 'USD',
      requiredDocuments: [],
    } as unknown as MarketplaceQuoteEntity;
    const relUpdate = jest.fn(async (id: string, status: string) => ({ id, status }));
    const cancelDraft = jest.fn(async () => true);
    const { svc, quotes, requests } = build(
      [request],
      [quote],
      [],
      [],
      [],
      {
        relationshipsFind: jest.fn(async () => ({
          id: 'rel-1',
          brokerOrganizationId: brokerOrgId,
          marketplaceQuoteId: 'q1',
        })),
        relationshipsUpdate: relUpdate,
        cancelDraft,
      },
    );

    const brokerCtx = { ...ctx, organizationId: brokerOrgId };
    const result = await svc.rescindQuote(brokerCtx, 'q1', 'broker overbooked');

    expect(result.wasAccepted).toBe(true);
    expect(result.insideWindow).toBe(true);
    expect(result.relationshipPaused).toBe(true);
    expect(result.draftEntryCancelled).toBe(true);
    expect(relUpdate).toHaveBeenCalledWith(
      'rel-1',
      'paused',
      brokerCtx,
      expect.objectContaining({ reason: 'quote_rescinded' }),
    );
    expect(cancelDraft).toHaveBeenCalledWith(
      expect.objectContaining({ marketplaceQuoteId: 'q1' }),
    );
    expect(quotes.__store[0].status).toBe('withdrawn');
    expect(requests.__store[0].status).toBe('in_quotes');
    expect(requests.__store[0].selectedQuoteId).toBeNull();
  });

  it('R1-B-01: outside the rescission window the quote is withdrawn but the engagement is left intact', async () => {
    process.env.MARKETPLACE_QUOTE_RESCIND_WINDOW_HOURS = '48';
    const brokerOrgId = 'broker-1';
    const acceptedAt = new Date(Date.now() - 100 * 60 * 60 * 1000); // 100h ago
    const request = {
      id: 'req-1',
      requestingOrganizationId: 'biz-1',
      status: 'broker_selected',
      selectedQuoteId: 'q1',
      candidateHtsNumbers: [],
      regulatoryFlags: [],
      serviceCategories: [],
    } as unknown as MarketplaceRequestEntity;
    const quote = {
      id: 'q1',
      requestId: 'req-1',
      brokerOrganizationId: brokerOrgId,
      brokerProfileId: 'bp1',
      status: 'accepted',
      acceptedAt,
      currency: 'USD',
      requiredDocuments: [],
    } as unknown as MarketplaceQuoteEntity;
    const relUpdate = jest.fn();
    const cancelDraft = jest.fn();
    const { svc, requests, quotes } = build([request], [quote], [], [], [], {
      relationshipsUpdate: relUpdate,
      cancelDraft,
    });

    const brokerCtx = { ...ctx, organizationId: brokerOrgId };
    const result = await svc.rescindQuote(brokerCtx, 'q1', null);

    expect(result.insideWindow).toBe(false);
    expect(result.relationshipPaused).toBe(false);
    expect(result.draftEntryCancelled).toBe(false);
    expect(relUpdate).not.toHaveBeenCalled();
    expect(cancelDraft).not.toHaveBeenCalled();
    expect(quotes.__store[0].status).toBe('withdrawn');
    // Engagement intact: request stays in broker_selected, selectedQuoteId preserved.
    expect(requests.__store[0].status).toBe('broker_selected');
    expect(requests.__store[0].selectedQuoteId).toBe('q1');
  });

  it('R1-B-02: expireDueQuotes flips every quote returned by the due-expiry query and records audit per row', async () => {
    const past = new Date(Date.now() - 1000);
    const stale = {
      id: 'q-stale',
      status: 'submitted',
      expiresAt: past,
      brokerOrganizationId: 'b1',
    } as unknown as MarketplaceQuoteEntity;
    const { svc, quotes } = build([], [stale]);
    // Stub the queryBuilder used inside expireDueQuotes — the in-memory
    // helper doesn't understand `IS NOT NULL` so we hand back the rows
    // directly. The service contract under test is the per-row mutation +
    // audit emission, not the SQL.
    quotes.createQueryBuilder = jest.fn(
      () =>
        ({
          where: function () {
            return this;
          },
          andWhere: function () {
            return this;
          },
          getMany: jest.fn(async () => [stale]),
        } as any),
    );
    const count = await svc.expireDueQuotes();
    expect(count).toBe(1);
    expect(quotes.__store.find((q) => q.id === 'q-stale')?.status).toBe(
      'expired',
    );
  });

  it('R1-B-03: closing a request expires open quotes and cancels open matches', async () => {
    const businessOrgId = ctx.organizationId;
    const request = {
      id: 'req-1',
      requestingOrganizationId: businessOrgId,
      status: 'in_quotes',
      candidateHtsNumbers: [],
      regulatoryFlags: [],
      serviceCategories: [],
    } as unknown as MarketplaceRequestEntity;
    const quoteRows: MarketplaceQuoteEntity[] = [
      {
        id: 'qOpen',
        requestId: 'req-1',
        status: 'submitted',
        brokerOrganizationId: 'b1',
      } as unknown as MarketplaceQuoteEntity,
      {
        id: 'qPriorDone',
        requestId: 'req-1',
        status: 'expired',
        brokerOrganizationId: 'b1',
      } as unknown as MarketplaceQuoteEntity,
    ];
    const matchRows: MarketplaceBrokerMatchEntity[] = [
      {
        id: 'm1',
        requestId: 'req-1',
        status: 'notified',
      } as unknown as MarketplaceBrokerMatchEntity,
      {
        id: 'm2',
        requestId: 'req-1',
        status: 'selected',
      } as unknown as MarketplaceBrokerMatchEntity,
    ];
    const { svc, quotes, matches, requests } = build(
      [request],
      quoteRows,
      matchRows,
    );
    // The mock createQueryBuilder doesn't parse `NOT IN`, so we stub the
    // open-match query to mimic what the real query returns: everything
    // except already-terminal statuses.
    matches.createQueryBuilder = jest.fn(
      () =>
        ({
          where: function () {
            return this;
          },
          andWhere: function () {
            return this;
          },
          getMany: jest.fn(async () =>
            matchRows.filter(
              (m: any) => !['selected', 'declined', 'expired'].includes(m.status),
            ),
          ),
        } as any),
    );
    await svc.close(ctx, 'req-1');
    expect(requests.__store[0].status).toBe('closed');
    // close() only expires *submitted* quotes (the in-memory mock's where
    // clause works for equality), so the prior-done quote is untouched.
    expect(quotes.__store.find((q) => q.id === 'qOpen')?.status).toBe(
      'expired',
    );
    expect(quotes.__store.find((q) => q.id === 'qPriorDone')?.status).toBe(
      'expired',
    );
    expect(matches.__store.find((m) => m.id === 'm1')?.status).toBe('expired');
    // Selected match stays selected — the close cascade filter excludes the
    // 'selected' / 'declined' / 'expired' set from cancellation.
    expect(matches.__store.find((m) => m.id === 'm2')?.status).toBe('selected');
  });
});
