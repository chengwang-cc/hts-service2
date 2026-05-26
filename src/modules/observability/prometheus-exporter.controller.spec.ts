import { PrometheusExporterController } from './prometheus-exporter.controller';
import { TelemetryService } from './telemetry.service';

describe('PrometheusExporterController', () => {
  let telemetry: TelemetryService;
  let controller: PrometheusExporterController;

  beforeEach(() => {
    telemetry = new TelemetryService();
    controller = new PrometheusExporterController(telemetry);
  });

  it('emits one # TYPE counter header per labelled counter group', () => {
    telemetry.countEvent('broker_outreach_invites_total', { status: 'sent' });
    telemetry.countEvent('broker_outreach_invites_total', { status: 'sent' });
    telemetry.countEvent('broker_outreach_invites_total', { status: 'claimed' });
    telemetry.countEvent('broker_outreach_discovery_runs_total', {
      provider: 'osm',
      status: 'succeeded',
    });

    const body = controller.scrape();

    expect(body).toContain('# TYPE broker_outreach_invites_total counter');
    expect(body).toContain(
      'broker_outreach_invites_total{status="sent"} 2',
    );
    expect(body).toContain(
      'broker_outreach_invites_total{status="claimed"} 1',
    );
    expect(body).toContain(
      '# TYPE broker_outreach_discovery_runs_total counter',
    );
    expect(body).toContain(
      'broker_outreach_discovery_runs_total{provider="osm",status="succeeded"} 1',
    );
    // Single TYPE per metric (no duplicates).
    const matches = body.match(/# TYPE broker_outreach_invites_total/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('emits gauges with the gauge type and absolute values', () => {
    telemetry.setGauge('knowledge_cards_pending_review_count', {}, 12);
    telemetry.setGauge(
      'knowledge_source_last_success_timestamp',
      { name: 'CBP CSMS', trust_tier: 'official' },
      1_700_000_000,
    );

    const body = controller.scrape();

    expect(body).toContain('# TYPE knowledge_cards_pending_review_count gauge');
    expect(body).toContain('knowledge_cards_pending_review_count 12');
    expect(body).toContain(
      '# TYPE knowledge_source_last_success_timestamp gauge',
    );
    expect(body).toContain(
      'knowledge_source_last_success_timestamp{name="CBP CSMS",trust_tier="official"} 1700000000',
    );
  });

  it('respects setGauge overwrites (last write wins)', () => {
    telemetry.setGauge('ecommerce_handoff_state_count', { state: 'x' }, 5);
    telemetry.setGauge('ecommerce_handoff_state_count', { state: 'x' }, 9);
    const body = controller.scrape();
    expect(body).toContain('ecommerce_handoff_state_count{state="x"} 9');
    expect(body).not.toContain('ecommerce_handoff_state_count{state="x"} 5');
  });
});
