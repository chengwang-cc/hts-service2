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

describe('MarketplaceRequestsService.acceptQuote — handoff (Plan M4-08)', () => {
  it('auto-creates broker client + relationship + draft entry', async () => {
    const draftEntryFn = jest.fn(async () => ({ id: 'draft-entry-1' }));
    const createRelFn = jest.fn(async (input: any) => ({
      id: 'rel-1',
      ...input,
    }));

    const businessOrgId = ctx.organizationId;
    const brokerOrgId = 'org-broker-1';

    const requests = createRepoMock<MarketplaceRequestEntity>([
      {
        id: 'req-1',
        requestingOrganizationId: businessOrgId,
        status: 'in_quotes',
        commoditySummary: 'cotton tees',
        candidateHtsNumbers: [],
        regulatoryFlags: [],
        serviceCategories: [],
      } as unknown as MarketplaceRequestEntity,
    ]);
    const quotes = createRepoMock<MarketplaceQuoteEntity>([
      {
        id: 'q1',
        requestId: 'req-1',
        brokerProfileId: 'bp1',
        brokerOrganizationId: brokerOrgId,
        status: 'submitted',
        currency: 'USD',
        requiredDocuments: [],
      } as unknown as MarketplaceQuoteEntity,
    ]);
    const matches = createRepoMock<MarketplaceBrokerMatchEntity>();
    const conversations = createRepoMock<MarketplaceConversationEntity>();
    const messages = createRepoMock<MarketplaceMessageEntity>();
    const brokerClients = createRepoMock<BrokerClientEntity>();
    const organizations = createRepoMock<OrganizationEntity>([
      { id: businessOrgId, name: 'Cool Importer Inc.' } as unknown as OrganizationEntity,
    ]);

    const svc = new MarketplaceRequestsService(
      requests as any,
      quotes as any,
      matches as any,
      conversations as any,
      messages as any,
      brokerClients as any,
      organizations as any,
      { preflight: jest.fn() } as any,
      {
        matchRequest: jest.fn(),
        listForRequest: jest.fn(async () => []),
        markViewed: jest.fn(),
        decline: jest.fn(),
        inviteSpecificBrokers: jest.fn(),
        allPublishedProfiles: jest.fn(),
      } as any,
      { create: createRelFn } as any,
      { draftFromHandoff: draftEntryFn } as any,
      createAuditMock(),
      { keyBelongsToTenant: () => true, createReadUrl: jest.fn(), providerKey: 'mock' } as any,
    );

    const result = await svc.acceptQuote(ctx, 'q1', { note: 'lgtm' });

    expect(brokerClients.__store).toHaveLength(1);
    expect(brokerClients.__store[0].name).toBe('Cool Importer Inc.');
    expect(brokerClients.__store[0].brokerOrganizationId).toBe(brokerOrgId);
    expect(createRelFn).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerOrganizationId: brokerOrgId,
        businessOrganizationId: businessOrgId,
        clientId: brokerClients.__store[0].id,
        marketplaceRequestId: 'req-1',
        marketplaceQuoteId: 'q1',
      }),
    );
    expect(draftEntryFn).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerOrganizationId: brokerOrgId,
        clientId: brokerClients.__store[0].id,
        entryType: 'consumption',
      }),
    );
    expect(result.draftEntryId).toBe('draft-entry-1');
    expect(requests.__store[0].status).toBe('broker_selected');
    expect(requests.__store[0].selectedBrokerProfileId).toBe('bp1');
  });

  it('reuses existing broker client row if one already exists for the business', async () => {
    const draftEntryFn = jest.fn(async () => ({ id: 'draft-2' }));
    const brokerOrgId = 'org-broker-1';
    const businessOrgId = ctx.organizationId;

    const requests = createRepoMock<MarketplaceRequestEntity>([
      {
        id: 'req-1',
        requestingOrganizationId: businessOrgId,
        status: 'in_quotes',
        candidateHtsNumbers: [],
        regulatoryFlags: [],
        serviceCategories: [],
      } as unknown as MarketplaceRequestEntity,
    ]);
    const quotes = createRepoMock<MarketplaceQuoteEntity>([
      {
        id: 'q1',
        requestId: 'req-1',
        brokerProfileId: 'bp1',
        brokerOrganizationId: brokerOrgId,
        status: 'submitted',
        currency: 'USD',
        requiredDocuments: [],
      } as unknown as MarketplaceQuoteEntity,
    ]);
    const brokerClients = createRepoMock<BrokerClientEntity>([
      {
        id: 'preexisting-client',
        brokerOrganizationId: brokerOrgId,
        clientOrganizationId: businessOrgId,
        name: 'Existing',
        status: 'active',
      } as unknown as BrokerClientEntity,
    ]);
    const organizations = createRepoMock<OrganizationEntity>([
      { id: businessOrgId, name: 'X' } as unknown as OrganizationEntity,
    ]);
    const svc = new MarketplaceRequestsService(
      requests as any,
      quotes as any,
      createRepoMock() as any,
      createRepoMock() as any,
      createRepoMock() as any,
      brokerClients as any,
      organizations as any,
      { preflight: jest.fn() } as any,
      {
        matchRequest: jest.fn(),
        listForRequest: jest.fn(async () => []),
      } as any,
      { create: jest.fn(async () => ({ id: 'rel-1' })) } as any,
      { draftFromHandoff: draftEntryFn } as any,
      createAuditMock(),
      { keyBelongsToTenant: () => true, createReadUrl: jest.fn(), providerKey: 'mock' } as any,
    );

    await svc.acceptQuote(ctx, 'q1', {});
    expect(brokerClients.__store).toHaveLength(1); // not duplicated
    expect(brokerClients.__store[0].id).toBe('preexisting-client');
    expect(draftEntryFn).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'preexisting-client' }),
    );
  });

  it('refuses to accept a non-submitted quote', async () => {
    const businessOrgId = ctx.organizationId;
    const requests = createRepoMock<MarketplaceRequestEntity>([
      {
        id: 'req-1',
        requestingOrganizationId: businessOrgId,
        status: 'in_quotes',
        candidateHtsNumbers: [],
        regulatoryFlags: [],
        serviceCategories: [],
      } as unknown as MarketplaceRequestEntity,
    ]);
    const quotes = createRepoMock<MarketplaceQuoteEntity>([
      {
        id: 'q1',
        requestId: 'req-1',
        brokerProfileId: 'bp1',
        brokerOrganizationId: 'org-broker',
        status: 'expired',
        currency: 'USD',
        requiredDocuments: [],
      } as unknown as MarketplaceQuoteEntity,
    ]);
    const svc = new MarketplaceRequestsService(
      requests as any,
      quotes as any,
      createRepoMock() as any,
      createRepoMock() as any,
      createRepoMock() as any,
      createRepoMock() as any,
      createRepoMock() as any,
      { preflight: jest.fn() } as any,
      { listForRequest: jest.fn(async () => []) } as any,
      { create: jest.fn() } as any,
      { draftFromHandoff: jest.fn() } as any,
      createAuditMock(),
      { keyBelongsToTenant: () => true, createReadUrl: jest.fn(), providerKey: 'mock' } as any,
    );
    await expect(svc.acceptQuote(ctx, 'q1', {})).rejects.toThrow(/cannot accept/i);
  });
});
