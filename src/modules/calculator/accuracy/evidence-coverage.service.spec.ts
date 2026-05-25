import {
  ComponentEvidenceRecord,
  EvidenceCoverageService,
} from './evidence-coverage.service';

describe('EvidenceCoverageService', () => {
  let service: EvidenceCoverageService;

  beforeEach(() => {
    service = new EvidenceCoverageService();
  });

  it('marks Section 301 rollout blocked without official_source + human_review', () => {
    const r = service.reportFor(componentWith('section_301', ['official_source']));
    expect(r.missing).toEqual(['human_review']);
    expect(r.coverageComplete).toBe(false);
    expect(r.rolloutAllowed).toBe(false);
  });

  it('marks Section 301 rollout allowed with both required kinds present', () => {
    const r = service.reportFor(
      componentWith('section_301', ['official_source', 'human_review']),
    );
    expect(r.missing).toEqual([]);
    expect(r.rolloutAllowed).toBe(true);
  });

  it('allows base rollout with only official_source', () => {
    const r = service.reportFor(componentWith('base', ['official_source']));
    expect(r.rolloutAllowed).toBe(true);
  });

  it('blocks base rollout without official_source', () => {
    const r = service.reportFor(componentWith('base', []));
    expect(r.rolloutAllowed).toBe(false);
    expect(r.missing).toContain('official_source');
  });

  it('defaults to other_chapter_99 SLA when programFamily is missing', () => {
    const r = service.reportFor({
      componentId: 'c1',
      evidence: [{ kind: 'official_source', recordedAt: '2026-05-25' }],
    });
    expect(r.programFamily).toBe('other_chapter_99');
    expect(r.rolloutAllowed).toBe(true);
  });

  it('summarize counts complete/incomplete and per-family rollups', () => {
    const reports = service.reportBatch([
      componentWith('section_301', ['official_source', 'human_review']),
      componentWith('section_301', ['official_source']),
      componentWith('section_232', ['official_source', 'human_review']),
      componentWith('base', ['official_source']),
      componentWith('base', []),
    ]);
    const s = service.summarize(reports);
    expect(s.total).toBe(5);
    expect(s.complete).toBe(3);
    expect(s.incomplete).toBe(2);
    expect(s.rolloutBlocked).toBe(2);
    expect(s.coveragePercentage).toBe(60);
    expect(s.byFamily.section_301).toEqual({ total: 2, complete: 1 });
    expect(s.byFamily.section_232).toEqual({ total: 1, complete: 1 });
    expect(s.byFamily.base).toEqual({ total: 2, complete: 1 });
  });

  it('lastRecordedAt is the most recent evidence timestamp', () => {
    const r = service.reportFor({
      componentId: 'c-late',
      programFamily: 'section_232',
      evidence: [
        { kind: 'official_source', recordedAt: '2026-01-10' },
        { kind: 'human_review', recordedAt: '2026-05-22' },
        { kind: 'broker_golden_set', recordedAt: '2026-03-15' },
      ],
    });
    expect(r.lastRecordedAt).toBe('2026-05-22');
  });
});

function componentWith(
  family: ComponentEvidenceRecord['programFamily'],
  kinds: string[],
): ComponentEvidenceRecord {
  return {
    componentId: `c-${family}-${kinds.join('+')}`,
    programFamily: family,
    evidence: kinds.map((k) => ({
      kind: k as any,
      recordedAt: '2026-05-20',
    })),
  };
}
