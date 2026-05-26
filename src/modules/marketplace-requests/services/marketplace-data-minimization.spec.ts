import { MarketplaceRequestsService } from './marketplace-requests.service';
import type {
  MarketplaceConversationEntity,
  MarketplaceRequestEntity,
} from '../entities';

/**
 * Regression spec for the broker-preview data-minimization contract.
 * Every sensitive field MUST be hidden until the business has consented
 * to share the full packet (conversation.fullPacketConsented === true).
 *
 * Adding a new sensitive field? Add it here as well as in
 * `brokerVisibleRequest`.
 */
describe('MarketplaceRequestsService.brokerVisibleRequest data minimization', () => {
  const baseRequest: Partial<MarketplaceRequestEntity> = {
    id: 'req-1',
    title: 'High-value Apparel shipment',
    commoditySummary:
      'A very long commodity summary that exceeds the teaser cut-off. '.repeat(
        10,
      ),
    originCountry: 'CN',
    destinationCountry: 'US',
    portOfEntry: 'USLAX',
    mode: 'ocean',
    serviceCategories: ['classification'],
    regulatoryFlags: ['textile-quota'],
    candidateHtsNumbers: ['6204.62.4011', '6204.62.4021'],
    readinessScore: 0.85,
    readinessBreakdown: { documents: 'partial' } as any,
    shipmentValue: '125000.00',
    shipmentCurrency: 'USD',
    shipmentVolume: '20 TEU',
    deadline: new Date('2026-06-01T00:00:00Z'),
    status: 'in_quotes',
    visibilityMode: 'invited',
    createdAt: new Date('2026-05-01T00:00:00Z'),
  };

  function buildService(): MarketplaceRequestsService {
    return new MarketplaceRequestsService(
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
    );
  }

  it('hides every sensitive field before full-packet consent', () => {
    const svc = buildService();
    const conversation = {
      fullPacketConsented: false,
    } as MarketplaceConversationEntity;
    const preview = svc.brokerVisibleRequestForTest(
      baseRequest as MarketplaceRequestEntity,
      conversation,
    );
    expect(preview.portOfEntry).toBeNull();
    expect(preview.regulatoryFlags).toEqual([]);
    expect(preview.candidateHtsNumbers).toEqual([]);
    expect(preview.shipmentValue).toBeNull();
    expect(preview.shipmentCurrency).toBeNull();
    expect(preview.shipmentVolume).toBeNull();
    expect(preview.readinessBreakdown).toBeNull();
    // commoditySummary is teased, not the full text.
    expect(preview.commoditySummary?.endsWith('…')).toBe(true);
    expect(preview.commoditySummary!.length).toBeLessThanOrEqual(201);
    // Only chapter-level previews of HTS codes (no full codes).
    expect(preview.candidateHtsChapters).toEqual(['62']);
    expect(preview.fullPacketConsented).toBe(false);
    expect(preview.detailLevel).toBe('matched_preview');
  });

  it('reveals every sensitive field after full-packet consent', () => {
    const svc = buildService();
    const conversation = {
      fullPacketConsented: true,
    } as MarketplaceConversationEntity;
    const preview = svc.brokerVisibleRequestForTest(
      baseRequest as MarketplaceRequestEntity,
      conversation,
    );
    expect(preview.portOfEntry).toBe('USLAX');
    expect(preview.regulatoryFlags).toEqual(['textile-quota']);
    expect(preview.candidateHtsNumbers).toEqual([
      '6204.62.4011',
      '6204.62.4021',
    ]);
    expect(preview.shipmentValue).toBe('125000.00');
    expect(preview.shipmentCurrency).toBe('USD');
    expect(preview.shipmentVolume).toBe('20 TEU');
    expect(preview.readinessBreakdown).toEqual({ documents: 'partial' });
    expect(preview.commoditySummary).toBe(baseRequest.commoditySummary);
    // No chapter teaser when full packet is consented.
    expect(preview.candidateHtsChapters).toEqual([]);
    expect(preview.fullPacketConsented).toBe(true);
    expect(preview.detailLevel).toBe('consented_detail');
  });

  it('treats undefined/null conversation as no consent', () => {
    const svc = buildService();
    const preview = svc.brokerVisibleRequestForTest(
      baseRequest as MarketplaceRequestEntity,
      null,
    );
    expect(preview.portOfEntry).toBeNull();
    expect(preview.shipmentValue).toBeNull();
    expect(preview.fullPacketConsented).toBe(false);
  });
});
