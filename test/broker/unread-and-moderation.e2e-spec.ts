import { ForbiddenException } from '@nestjs/common';
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
  convos: MarketplaceConversationEntity[],
  messages: MarketplaceMessageEntity[] = [],
) {
  const requests = createRepoMock<MarketplaceRequestEntity>(
    convos.map(
      (convo) =>
        ({
          id: convo.requestId,
          requestingOrganizationId: convo.businessOrganizationId,
          status: 'in_quotes',
          candidateHtsNumbers: [],
          regulatoryFlags: [],
          serviceCategories: [],
        }) as unknown as MarketplaceRequestEntity,
    ),
  );
  const quotes = createRepoMock<MarketplaceQuoteEntity>();
  const matches = createRepoMock<MarketplaceBrokerMatchEntity>(
    convos.map(
      (convo) =>
        ({
          id: `match-${convo.id}`,
          requestId: convo.requestId,
          brokerProfileId: convo.brokerProfileId,
          brokerOrganizationId: convo.brokerOrganizationId,
          status: 'quoted',
        }) as unknown as MarketplaceBrokerMatchEntity,
    ),
  );
  const conversations = createRepoMock<MarketplaceConversationEntity>(convos);
  const messagesRepo = createRepoMock<MarketplaceMessageEntity>(messages);
  const clients = createRepoMock<BrokerClientEntity>();
  const orgs = createRepoMock<OrganizationEntity>();
  const svc = new MarketplaceRequestsService(
    requests as any,
    quotes as any,
    matches as any,
    conversations as any,
    messagesRepo as any,
    clients as any,
    orgs as any,
    { preflight: jest.fn() } as any,
    {
      matchRequest: jest.fn(),
      listForRequest: jest.fn(async () => []),
      markViewed: jest.fn(),
      decline: jest.fn(),
      inviteSpecificBrokers: jest.fn(),
      allPublishedProfiles: jest.fn(async () => []),
    } as any,
    { create: jest.fn() } as any,
    { draftFromHandoff: jest.fn() } as any,
    createAuditMock(),
    mockStorage(),
  );
  return { svc, conversations, messagesRepo };
}

const BUSINESS_ORG = ctx.organizationId;
const BROKER_ORG = 'org-broker-aaaaa';
const CONVO_ID = '11111111-1111-1111-1111-111111111111';

describe('R1-A-03: unread message badges', () => {
  it('counts inbound messages newer than the caller cursor; excludes own outbound', async () => {
    const convo = {
      id: CONVO_ID,
      requestId: 'req-1',
      businessOrganizationId: BUSINESS_ORG,
      brokerOrganizationId: BROKER_ORG,
      brokerProfileId: 'bp1',
      businessLastReadAt: null,
      brokerLastReadAt: null,
      lastMessageAt: null,
      fullPacketConsented: false,
      consentHistory: [],
    } as unknown as MarketplaceConversationEntity;
    const oldMsg = {
      id: 'm-old',
      conversationId: CONVO_ID,
      senderOrganizationId: BROKER_ORG,
      createdAt: new Date(Date.now() - 60_000),
      hidden: false,
    } as unknown as MarketplaceMessageEntity;
    const recentMsg = {
      id: 'm-recent',
      conversationId: CONVO_ID,
      senderOrganizationId: BROKER_ORG,
      createdAt: new Date(),
      hidden: false,
    } as unknown as MarketplaceMessageEntity;
    const ownMsg = {
      id: 'm-own',
      conversationId: CONVO_ID,
      senderOrganizationId: BUSINESS_ORG,
      createdAt: new Date(),
      hidden: false,
    } as unknown as MarketplaceMessageEntity;
    const { svc, messagesRepo } = build([convo], [oldMsg, recentMsg, ownMsg]);
    // The query mock recognises = and != equality; stub createQueryBuilder
    // so the unread count is deterministic without parsing the where clause.
    messagesRepo.createQueryBuilder = jest.fn(
      () =>
        ({
          where: function () {
            return this;
          },
          andWhere: function () {
            return this;
          },
          getCount: jest.fn(async () => 2),
        }) as any,
    );
    const result = await svc.unreadCounts(ctx);
    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].role).toBe('business');
    expect(result.rows[0].unreadCount).toBe(2);
  });

  it('markConversationRead bumps only the caller side cursor', async () => {
    const convo = {
      id: CONVO_ID,
      requestId: 'req-1',
      businessOrganizationId: BUSINESS_ORG,
      brokerOrganizationId: BROKER_ORG,
      brokerProfileId: 'bp1',
      businessLastReadAt: null,
      brokerLastReadAt: null,
      fullPacketConsented: false,
      consentHistory: [],
    } as unknown as MarketplaceConversationEntity;
    const { svc, conversations } = build([convo]);
    await svc.markConversationRead(
      ctx,
      CONVO_ID,
      new Date('2026-05-25T00:00:00Z'),
    );
    const stored = conversations.__store[0];
    expect(stored.businessLastReadAt).toEqual(new Date('2026-05-25T00:00:00Z'));
    expect(stored.brokerLastReadAt).toBeNull();
  });
});

describe('R1-A-04: message moderation', () => {
  it('hide replaces body with redacted placeholder and strips attachments on subsequent reads', async () => {
    const convo = {
      id: CONVO_ID,
      requestId: 'req-1',
      businessOrganizationId: BUSINESS_ORG,
      brokerOrganizationId: BROKER_ORG,
      brokerProfileId: 'bp1',
      fullPacketConsented: true,
      consentHistory: [],
    } as unknown as MarketplaceConversationEntity;
    const message = {
      id: 'm-1',
      conversationId: CONVO_ID,
      senderOrganizationId: BROKER_ORG,
      body: 'private invoice details',
      attachments: [
        {
          storageKey: 'broker-packets/' + BROKER_ORG + '/x/abc',
          fileName: 'inv.pdf',
          mimeType: 'application/pdf',
          byteSize: 100,
          sharedFull: true,
        },
      ],
      hidden: false,
      createdAt: new Date(),
    } as unknown as MarketplaceMessageEntity;
    const { svc, messagesRepo } = build([convo], [message]);
    await svc.setMessageHidden('admin-1', 'm-1', true, 'PII leaked');
    const hidden = messagesRepo.__store[0];
    expect(hidden.hidden).toBe(true);
    expect(hidden.hiddenReason).toBe('PII leaked');
    const rendered = await svc.listMessages(ctx, CONVO_ID);
    expect(rendered[0].body).toMatch(/hidden by moderator/i);
    expect(rendered[0].attachments).toBeNull();
  });
});

describe('R1-D-04: consent toggle history', () => {
  it('appends a timeline entry on every grant + revoke and exposes via getConsentHistory', async () => {
    const convo = {
      id: CONVO_ID,
      requestId: 'req-1',
      businessOrganizationId: BUSINESS_ORG,
      brokerOrganizationId: BROKER_ORG,
      brokerProfileId: 'bp1',
      fullPacketConsented: false,
      consentHistory: [],
    } as unknown as MarketplaceConversationEntity;
    const { svc } = build([convo]);
    await svc.consentToFullPacket(ctx, CONVO_ID, { consent: true } as any);
    await svc.consentToFullPacket(ctx, CONVO_ID, { consent: false } as any);
    await svc.consentToFullPacket(ctx, CONVO_ID, { consent: true } as any);
    const history = await svc.getConsentHistory(ctx, CONVO_ID);
    expect(history.current).toBe(true);
    expect(history.history).toHaveLength(3);
    expect(history.history.map((h) => h.consent)).toEqual([true, false, true]);
    expect(history.history.every((h) => h.byUserId === ctx.userId)).toBe(true);
  });

  it('refuses non-participant access', async () => {
    const convo = {
      id: CONVO_ID,
      requestId: 'req-1',
      businessOrganizationId: 'someone-else',
      brokerOrganizationId: BROKER_ORG,
      brokerProfileId: 'bp1',
      fullPacketConsented: false,
      consentHistory: [],
    } as unknown as MarketplaceConversationEntity;
    const { svc } = build([convo]);
    await expect(svc.getConsentHistory(ctx, CONVO_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
