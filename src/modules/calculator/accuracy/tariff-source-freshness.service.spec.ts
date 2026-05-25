import { TariffSourceFreshnessService } from './tariff-source-freshness.service';
import type {
  SourceFreshnessRecord,
} from './tariff-source-freshness.types';

const NOW = new Date('2026-05-25T12:00:00Z');

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe('TariffSourceFreshnessService', () => {
  let service: TariffSourceFreshnessService;

  beforeEach(() => {
    service = new TariffSourceFreshnessService();
  });

  describe('classify', () => {
    it('reports fresh for USITC within 14 days', () => {
      const report = service.scoreRecord(makeUsitc({ daysAgo: 5 }), NOW);
      expect(report.status).toBe('fresh');
      expect(report.needsRefresh).toBe(false);
      expect(report.blocksRollout).toBe(false);
    });

    it('reports aging for USITC at 30 days', () => {
      expect(service.scoreRecord(makeUsitc({ daysAgo: 30 }), NOW).status).toBe(
        'aging',
      );
    });

    it('reports stale for USITC at 90 days and flags needsRefresh', () => {
      const r = service.scoreRecord(makeUsitc({ daysAgo: 90 }), NOW);
      expect(r.status).toBe('stale');
      expect(r.needsRefresh).toBe(true);
      expect(r.blocksRollout).toBe(false);
    });

    it('reports expired for USITC at 200 days and blocks rollout', () => {
      const r = service.scoreRecord(makeUsitc({ daysAgo: 200 }), NOW);
      expect(r.status).toBe('expired');
      expect(r.blocksRollout).toBe(true);
    });

    it('reports unknown when neither lastObservedAt nor upstreamLastChangedAt is set', () => {
      const r = service.scoreRecord(
        {
          sourceId: 'unknown',
          kind: 'usitc_hts',
          label: 'USITC',
          lastObservedAt: null,
          upstreamLastChangedAt: null,
          dependentComponentCount: 5,
        },
        NOW,
      );
      expect(r.status).toBe('unknown');
      expect(r.needsRefresh).toBe(true);
      expect(r.blocksRollout).toBe(false);
      expect(r.ageDays).toBeNull();
    });
  });

  describe('per-kind SLA defaults', () => {
    it('uses shorter SLA for cbp_csms than for usitc_hts', () => {
      const usitc = service.thresholdsFor('usitc_hts');
      const csms = service.thresholdsFor('cbp_csms');
      expect(csms.freshDays).toBeLessThan(usitc.freshDays);
      expect(csms.expiryDays).toBeLessThan(usitc.expiryDays);
    });

    it('treats a 10-day-old CBP CSMS source as aging', () => {
      const r = service.scoreRecord(
        {
          sourceId: 'cbp:csms_2026_005',
          kind: 'cbp_csms',
          label: 'CSMS 2026-005',
          lastObservedAt: isoDaysAgo(10),
          upstreamLastChangedAt: isoDaysAgo(10),
          dependentComponentCount: 2,
        },
        NOW,
      );
      expect(r.status).toBe('aging');
    });
  });

  describe('env-driven overrides', () => {
    it('parses SOURCE_FRESHNESS_OVERRIDES into per-kind thresholds', () => {
      service.configureFromEnv('usitc_hts:7/30/60,cbp_csms:1/3/7');
      expect(service.thresholdsFor('usitc_hts')).toEqual({
        freshDays: 7,
        stalenessDays: 30,
        expiryDays: 60,
      });
      expect(service.thresholdsFor('cbp_csms')).toEqual({
        freshDays: 1,
        stalenessDays: 3,
        expiryDays: 7,
      });
    });

    it('ignores malformed entries', () => {
      service.configureFromEnv('not-a-kind,broken:1/2,usitc_hts:7/30/60');
      expect(service.thresholdsFor('usitc_hts').freshDays).toBe(7);
      // ustr_section_301 was not overridden so default sticks.
      expect(service.thresholdsFor('ustr_section_301').freshDays).toBe(7);
    });
  });

  describe('summarize', () => {
    it('rolls up counts by status and surfaces refresh + rollout queues', () => {
      const reports = service.scoreBatch(
        [
          makeUsitc({ daysAgo: 5 }), // fresh
          makeUsitc({ daysAgo: 30, sourceId: 'u2' }), // aging
          makeUsitc({ daysAgo: 90, sourceId: 'u3' }), // stale → needs refresh
          makeUsitc({ daysAgo: 200, sourceId: 'u4' }), // expired → blocks rollout
        ],
        NOW,
      );
      const summary = service.summarize(reports);
      expect(summary.total).toBe(4);
      expect(summary.countsByStatus.fresh).toBe(1);
      expect(summary.countsByStatus.aging).toBe(1);
      expect(summary.countsByStatus.stale).toBe(1);
      expect(summary.countsByStatus.expired).toBe(1);
      expect(summary.needsRefresh.map((r) => r.sourceId).sort()).toEqual([
        'u3',
        'u4',
      ]);
      expect(summary.blocksRollout.map((r) => r.sourceId)).toEqual(['u4']);
    });

    it('does not flag needsRefresh when no components depend on the source', () => {
      const report = service.scoreRecord(
        makeUsitc({ daysAgo: 200, dependentComponentCount: 0 }),
        NOW,
      );
      expect(report.status).toBe('expired');
      expect(report.needsRefresh).toBe(false);
      expect(report.blocksRollout).toBe(false);
    });
  });
});

function makeUsitc(opts: {
  daysAgo: number;
  sourceId?: string;
  dependentComponentCount?: number;
}): SourceFreshnessRecord {
  return {
    sourceId: opts.sourceId ?? 'usitc_hts:2026-rev-8',
    kind: 'usitc_hts',
    label: 'USITC HTS 2026 Rev 8',
    lastObservedAt: isoDaysAgo(opts.daysAgo),
    upstreamLastChangedAt: isoDaysAgo(opts.daysAgo),
    dependentComponentCount: opts.dependentComponentCount ?? 1000,
  };
}
