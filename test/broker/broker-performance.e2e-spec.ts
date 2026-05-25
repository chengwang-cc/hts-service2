import { BrokerPerformanceService } from '../../src/modules/marketplace-reviews/services/broker-performance.service';
import { createRepoMock } from './helpers';
import type { MarketplaceBrokerProfileEntity } from '../../src/modules/marketplace/entities';
import type {
  MarketplaceBrokerMatchEntity,
  MarketplaceQuoteEntity,
} from '../../src/modules/marketplace-requests/entities';
import type { MarketplaceReviewEntity } from '../../src/modules/marketplace-reviews/entities';
import type { BrokerPerformanceSnapshotEntity } from '../../src/modules/marketplace-reviews/entities';

describe('BrokerPerformanceService.snapshotForBroker', () => {
  it('computes response/quote/close rates from matches+quotes', async () => {
    const profiles = createRepoMock<MarketplaceBrokerProfileEntity>([
      { id: 'p1', organizationId: 'o1' } as MarketplaceBrokerProfileEntity,
    ]);
    const matches = createRepoMock<MarketplaceBrokerMatchEntity>([
      { id: 'm1', brokerProfileId: 'p1', status: 'notified' },
      { id: 'm2', brokerProfileId: 'p1', status: 'viewed' },
      { id: 'm3', brokerProfileId: 'p1', status: 'quoted' },
      { id: 'm4', brokerProfileId: 'p1', status: 'selected' },
    ] as unknown as MarketplaceBrokerMatchEntity[]);
    const quotes = createRepoMock<MarketplaceQuoteEntity>([
      { id: 'q1', brokerProfileId: 'p1', status: 'submitted' },
      { id: 'q2', brokerProfileId: 'p1', status: 'accepted' },
      { id: 'q3', brokerProfileId: 'p1', status: 'rejected' },
      { id: 'q4', brokerProfileId: 'p1', status: 'draft' }, // excluded
    ] as unknown as MarketplaceQuoteEntity[]);
    const reviews = createRepoMock<MarketplaceReviewEntity>([
      {
        id: 'r1',
        brokerProfileId: 'p1',
        rating: 5,
        moderationStatus: 'approved',
      },
      {
        id: 'r2',
        brokerProfileId: 'p1',
        rating: 4,
        moderationStatus: 'approved',
      },
      {
        id: 'r3',
        brokerProfileId: 'p1',
        rating: 1,
        moderationStatus: 'hidden',
      },
    ] as unknown as MarketplaceReviewEntity[]);
    const snapshots = createRepoMock<BrokerPerformanceSnapshotEntity>();

    const svc = new BrokerPerformanceService(
      profiles as any,
      matches as any,
      quotes as any,
      reviews as any,
      snapshots as any,
    );
    const snap = await svc.snapshotForBroker('p1');
    expect(snap.leadsNotified).toBe(4);
    expect(snap.leadsViewed).toBe(3); // viewed | quoted | selected
    expect(snap.quotesSubmitted).toBe(3); // exclude draft
    expect(snap.quotesAccepted).toBe(1);
    expect(snap.responseRate).toBe('0.7500');
    expect(snap.quoteRate).toBe('1.0000');
    expect(snap.closeRate).toBe('0.3333');
    expect(snap.averageRating).toBe('4.50'); // only approved reviews
  });

  it('returns nulls when there are no leads/quotes/reviews', async () => {
    const profiles = createRepoMock<MarketplaceBrokerProfileEntity>([
      { id: 'p1', organizationId: 'o1' } as MarketplaceBrokerProfileEntity,
    ]);
    const svc = new BrokerPerformanceService(
      profiles as any,
      createRepoMock() as any,
      createRepoMock() as any,
      createRepoMock() as any,
      createRepoMock() as any,
    );
    const snap = await svc.snapshotForBroker('p1');
    expect(snap.responseRate).toBeNull();
    expect(snap.quoteRate).toBeNull();
    expect(snap.closeRate).toBeNull();
    expect(snap.averageRating).toBeNull();
  });
});
