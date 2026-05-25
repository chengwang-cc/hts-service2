import { AccuracySchedulerService } from './accuracy-scheduler.service';
import { TariffSourceFreshnessService } from './tariff-source-freshness.service';
import {
  EvidenceCoverageService,
  ComponentEvidenceRecord,
} from './evidence-coverage.service';
import type { SourceFreshnessRecord } from './tariff-source-freshness.types';

const NOW = new Date('2026-05-25T12:00:00Z');
const isoDaysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('AccuracySchedulerService', () => {
  let scheduler: AccuracySchedulerService;

  beforeEach(() => {
    scheduler = new AccuracySchedulerService(
      new TariffSourceFreshnessService(),
      new EvidenceCoverageService(),
    );
  });

  it('returns a structured tick result with rolled-up counts', async () => {
    const result = await scheduler.tick(
      providerWith(
        [
          freshness('usitc:r8', 'usitc_hts', 5, 1000), // fresh
          freshness('cbp:csms-1', 'cbp_csms', 60, 50), // expired → blocks rollout
          freshness('ustr:l4a', 'ustr_section_301', 45, 10), // stale → refresh
        ],
        [
          evidence('c-301-a', 'section_301', ['official_source', 'human_review']), // complete
          evidence('c-301-b', 'section_301', ['official_source']), // missing human_review
          evidence('c-232-a', 'section_232', ['official_source', 'human_review']),
        ],
      ),
      NOW,
    );

    expect(result.freshness.total).toBe(3);
    expect(result.freshness.needsRefresh).toBe(2); // stale + expired
    expect(result.freshness.blocksRollout).toBe(1); // expired

    expect(result.evidence.total).toBe(3);
    expect(result.evidence.incomplete).toBe(1);
    expect(result.evidence.rolloutBlocked).toBe(1);
    expect(result.evidence.coveragePercentage).toBeCloseTo(66.7, 0);
  });

  it('emits review tasks sorted by priority (rollout blocks first)', async () => {
    const result = await scheduler.tick(
      providerWith(
        [
          freshness('cbp:csms-expired', 'cbp_csms', 60, 50),
          freshness('usitc:stale', 'usitc_hts', 90, 10),
        ],
        [
          evidence('c-incomplete', 'section_301', ['official_source']),
        ],
      ),
      NOW,
    );

    expect(result.reviewTasks.length).toBeGreaterThanOrEqual(3);
    expect(result.reviewTasks[0].priority).toBeGreaterThanOrEqual(
      result.reviewTasks[result.reviewTasks.length - 1].priority,
    );
    const kinds = result.reviewTasks.map((t) => t.kind);
    expect(kinds).toContain('rollout_block');
    expect(kinds).toContain('refresh_source');
  });

  it('attaches sourceId / componentId references on each task', async () => {
    const result = await scheduler.tick(
      providerWith(
        [freshness('usitc:expired', 'usitc_hts', 200, 100)],
        [evidence('c-301-missing', 'section_301', ['official_source'])],
      ),
      NOW,
    );

    const refresh = result.reviewTasks.find(
      (t) => t.kind === 'rollout_block' && t.references.sourceId === 'usitc:expired',
    );
    expect(refresh).toBeDefined();

    const evid = result.reviewTasks.find(
      (t) => t.references.componentId === 'c-301-missing',
    );
    expect(evid).toBeDefined();
    expect(evid!.kind).toBe('rollout_block');
  });

  it('returns an empty review queue when everything is fresh + complete', async () => {
    const result = await scheduler.tick(
      providerWith(
        [freshness('usitc:r8', 'usitc_hts', 1, 1000)],
        [evidence('c-base', 'base', ['official_source'])],
      ),
      NOW,
    );
    expect(result.reviewTasks).toEqual([]);
    expect(result.freshness.blocksRollout).toBe(0);
    expect(result.evidence.rolloutBlocked).toBe(0);
  });
});

function providerWith(
  freshnessRecords: SourceFreshnessRecord[],
  evidenceRecords: ComponentEvidenceRecord[],
) {
  return {
    loadFreshnessRecords: async () => freshnessRecords,
    loadEvidenceRecords: async () => evidenceRecords,
  };
}

function freshness(
  sourceId: string,
  kind: SourceFreshnessRecord['kind'],
  daysAgo: number,
  dependentComponentCount: number,
): SourceFreshnessRecord {
  return {
    sourceId,
    kind,
    label: sourceId,
    lastObservedAt: isoDaysAgo(daysAgo),
    upstreamLastChangedAt: isoDaysAgo(daysAgo),
    dependentComponentCount,
  };
}

function evidence(
  id: string,
  family: ComponentEvidenceRecord['programFamily'],
  kinds: string[],
): ComponentEvidenceRecord {
  return {
    componentId: id,
    programFamily: family,
    evidence: kinds.map((k) => ({ kind: k as any, recordedAt: '2026-05-20' })),
  };
}
