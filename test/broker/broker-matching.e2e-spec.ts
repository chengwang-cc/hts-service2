import { BrokerMatchingService } from '../../src/modules/marketplace-requests/services/broker-matching.service';
import { createRepoMock } from './helpers';
import type { MarketplaceBrokerMatchEntity } from '../../src/modules/marketplace-requests/entities';
import type { MarketplaceRequestEntity } from '../../src/modules/marketplace-requests/entities';
import type { MarketplaceBrokerProfileEntity } from '../../src/modules/marketplace/entities';

function profile(overrides: Partial<MarketplaceBrokerProfileEntity> = {}): MarketplaceBrokerProfileEntity {
  return {
    id: 'p-' + (overrides.id ?? Math.random().toString(36).slice(2, 6)),
    organizationId: 'o-' + (overrides.organizationId ?? Math.random().toString(36).slice(2, 6)),
    ownerUserId: 'u',
    companyName: 'Acme',
    slug: 'acme',
    tagline: null,
    description: null,
    status: 'published',
    verificationStatus: 'verified',
    countries: ['US', 'VN'],
    ports: ['USLAX'],
    serviceCategories: ['classification', 'entry_filing'],
    shipmentModes: ['ocean'],
    languages: ['en'],
    specialties: ['textile'],
    complianceBadges: ['SOC2'],
    aiCapabilities: {
      supportsAiClassification: true,
      supportsDocumentAutomation: false,
      supportsDutyAudit: false,
    },
    metrics: { averageResponseHours: 4, satisfactionScore: 4.5 },
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

function request(overrides: Partial<MarketplaceRequestEntity> = {}): MarketplaceRequestEntity {
  return {
    id: 'req-1',
    requestingOrganizationId: 'biz-1',
    requestingUserId: 'user-1',
    status: 'open',
    requestType: 'one_time',
    title: null,
    commoditySummary: 'cotton t-shirts',
    originCountry: 'VN',
    destinationCountry: 'US',
    portOfEntry: 'USLAX',
    mode: 'ocean',
    candidateHtsNumbers: ['6109.10'],
    regulatoryFlags: ['TEXTILE'],
    serviceCategories: ['classification', 'entry_filing'],
    shipmentValue: '10000',
    shipmentCurrency: 'USD',
    shipmentVolume: null,
    readinessScore: 80,
    readinessBreakdown: null,
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

describe('BrokerMatchingService', () => {
  function build() {
    const profiles = createRepoMock<MarketplaceBrokerProfileEntity>();
    const matches = createRepoMock<MarketplaceBrokerMatchEntity>();
    const svc = new BrokerMatchingService(profiles as any, matches as any);
    return { svc, profiles, matches };
  }

  it('ranks the fully-matching broker first, lowest-fit broker last', async () => {
    const { svc, profiles } = build();
    profiles.__store.push(
      profile({ id: 'best', organizationId: 'o-best' }),
      profile({
        id: 'mid',
        organizationId: 'o-mid',
        serviceCategories: ['warehouse'],
        countries: ['US'],
        shipmentModes: ['air'],
      }),
      profile({
        id: 'worst',
        organizationId: 'o-worst',
        verificationStatus: 'pending',
      }),
    );
    const result = await svc.matchRequest(request(), 5);
    expect(result.length).toBeGreaterThan(0);
    const scores = result.map((m) => Number(m.matchScore));
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
    expect(result[0].brokerProfileId).toBe('best');
  });

  it('decline() flips status and stores reason for the right broker only', async () => {
    const { svc, matches } = build();
    matches.__store.push({
      id: 'm1',
      brokerOrganizationId: 'o-broker',
      status: 'notified',
    } as unknown as MarketplaceBrokerMatchEntity);
    const wrong = await svc.decline('m1', 'o-other');
    expect(wrong).toBeNull();
    const ok = await svc.decline('m1', 'o-broker', 'no capacity');
    expect(ok?.status).toBe('declined');
    expect(ok?.declineReason).toBe('no capacity');
  });

  it('markViewed only changes status if currently notified', async () => {
    const { svc, matches } = build();
    matches.__store.push({
      id: 'm1',
      brokerOrganizationId: 'o-broker',
      status: 'quoted',
    } as unknown as MarketplaceBrokerMatchEntity);
    const after = await svc.markViewed('m1', 'o-broker');
    expect(after?.status).toBe('quoted'); // unchanged
  });

  it('inviteSpecificBrokers skips unverified profiles', async () => {
    const { svc, profiles, matches } = build();
    profiles.__store.push(
      profile({ id: 'verif', organizationId: 'o-v' }),
      profile({ id: 'unv', organizationId: 'o-u', verificationStatus: 'pending' }),
    );
    const created = await svc.inviteSpecificBrokers(request(), ['verif', 'unv']);
    expect(created).toHaveLength(1);
    expect(created[0].brokerProfileId).toBe('verif');
    expect(matches.__store.find((m) => m.brokerProfileId === 'unv')).toBeUndefined();
  });
});
