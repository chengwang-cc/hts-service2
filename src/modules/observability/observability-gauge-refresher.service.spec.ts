import { ObservabilityGaugeRefresherService } from './observability-gauge-refresher.service';
import { TelemetryService } from './telemetry.service';

describe('ObservabilityGaugeRefresherService', () => {
  it('refreshes knowledge card counts + ecommerce handoff state counts', async () => {
    const telemetry = new TelemetryService();
    const cards = {
      count: jest.fn(async ({ where }: { where: { status: string } }) => {
        return where.status === 'pending_review' ? 3 : 17;
      }),
    } as any;
    const handoffs = {
      createQueryBuilder: jest.fn(() => {
        const chain: any = {
          select: () => chain,
          addSelect: () => chain,
          groupBy: () => chain,
          getRawMany: async () => [
            { state: 'broker_review_required', count: '8' },
            { state: 'classification_needed', count: '2' },
          ],
        };
        return chain;
      }),
    } as any;
    const refresher = new ObservabilityGaugeRefresherService(
      telemetry,
      cards,
      handoffs,
    );
    await refresher.refreshOnce();
    const snap = telemetry.snapshot();
    expect(snap.gauges['knowledge_cards_pending_review_count']).toBe(3);
    expect(snap.gauges['knowledge_cards_active_count']).toBe(17);
    expect(
      snap.gauges['ecommerce_handoff_state_count{state=broker_review_required}'],
    ).toBe(8);
    expect(
      snap.gauges['ecommerce_handoff_state_count{state=classification_needed}'],
    ).toBe(2);
    // Canonical states with no rows are pinned to 0 so dashboards always
    // have a value to render.
    expect(
      snap.gauges['ecommerce_handoff_state_count{state=broker_released}'],
    ).toBe(0);
    expect(
      snap.gauges['ecommerce_handoff_state_count{state=fulfillment_blocked}'],
    ).toBe(0);
  });

  it('does not throw when the repos are unbound', async () => {
    const telemetry = new TelemetryService();
    const refresher = new ObservabilityGaugeRefresherService(
      telemetry,
      null,
      null,
    );
    await refresher.refreshOnce();
    expect(Object.keys(telemetry.snapshot().gauges)).toEqual([]);
  });
});
