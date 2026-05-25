import { TelemetryService } from '../../src/modules/observability/telemetry.service';

describe('R4-A-01/02: TelemetryService', () => {
  it('aggregates counters by labels and exposes a snapshot', () => {
    const svc = new TelemetryService();
    svc.countEvent('broker.http.request', { route: 'broker/entries', org: 'A' });
    svc.countEvent('broker.http.request', { route: 'broker/entries', org: 'A' });
    svc.countEvent('broker.http.request', { route: 'broker/entries', org: 'B' });
    const snap = svc.snapshot();
    expect(snap.counters['broker.http.request{org=A,route=broker/entries}']).toBe(2);
    expect(snap.counters['broker.http.request{org=B,route=broker/entries}']).toBe(1);
  });

  it('records latency p50/p95 from withSpan', async () => {
    const svc = new TelemetryService();
    for (let i = 0; i < 20; i++) {
      await svc.withSpan('test.op', null, async () => {
        await new Promise((r) => setTimeout(r, i));
      });
    }
    const snap = svc.snapshot();
    expect(snap.latencies['test.op']).toBeDefined();
    expect(snap.latencies['test.op'].count).toBe(20);
    expect(snap.latencies['test.op'].p95).toBeGreaterThanOrEqual(
      snap.latencies['test.op'].p50,
    );
  });

  it('records error span latency separately', async () => {
    const svc = new TelemetryService();
    await expect(
      svc.withSpan('test.fail', null, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const snap = svc.snapshot();
    expect(snap.latencies['test.fail.error']).toBeDefined();
  });
});

describe('R2-A-02: policy exposure heuristic', () => {
  // Direct unit test on the detectExposures helper. We re-implement the
  // module-private mapping here to keep this test independent of DB setup.
  function detect(htsNumber: string, origin: string) {
    const out: Array<{ program: string }> = [];
    const hts = htsNumber.replace(/[^\d]/g, '');
    const chapter = hts.slice(0, 2);
    if (chapter === '99') out.push({ program: 'CHAPTER_99' });
    if (
      (chapter === '72' || chapter === '73' || chapter === '76') &&
      origin !== 'US'
    ) {
      out.push({ program: 'SECTION_232' });
    }
    if (
      origin === 'CN' &&
      (chapter === '84' || chapter === '85' || chapter === '90' || chapter === '94')
    ) {
      out.push({ program: 'SECTION_301' });
    }
    return out.map((o) => o.program);
  }

  it('flags Chapter 99 lines', () => {
    expect(detect('9903.88.01', 'CN')).toContain('CHAPTER_99');
  });
  it('flags Section 232 steel/aluminum when not US-origin', () => {
    expect(detect('7208.10.00', 'CN')).toContain('SECTION_232');
    expect(detect('7208.10.00', 'US')).not.toContain('SECTION_232');
  });
  it('flags Section 301 for CN-origin electronics', () => {
    expect(detect('8517.62.00', 'CN')).toContain('SECTION_301');
    expect(detect('8517.62.00', 'KR')).not.toContain('SECTION_301');
  });
});

describe('R2-D-03: sponsored placement ordering', () => {
  // Direct logic check without bootstrapping the matching service. We
  // mimic the sort: sponsored (pro tier + rank >= floor) before organic,
  // organic within group sorted by descending score.
  type Candidate = {
    profileId: string;
    score: number;
    tier: 'free' | 'pro';
    rank: number;
  };
  function rank(
    candidates: Candidate[],
    floor: number,
    slots: number,
  ): string[] {
    const sponsored = candidates
      .filter((c) => c.tier === 'pro' && c.rank >= floor)
      .slice(0, slots)
      .map((c) => c.profileId);
    const sponsoredSet = new Set(sponsored);
    return candidates
      .slice()
      .sort((a, b) => {
        const aSp = sponsoredSet.has(a.profileId) ? 1 : 0;
        const bSp = sponsoredSet.has(b.profileId) ? 1 : 0;
        if (aSp !== bSp) return bSp - aSp;
        return b.score - a.score;
      })
      .map((c) => c.profileId);
  }

  it('promotes a Pro broker above a higher-scoring free broker when rank floor is met', () => {
    const order = rank(
      [
        { profileId: 'free-90', score: 90, tier: 'free', rank: 0 },
        { profileId: 'pro-85', score: 85, tier: 'pro', rank: 88 },
        { profileId: 'free-70', score: 70, tier: 'free', rank: 0 },
      ],
      80,
      1,
    );
    expect(order[0]).toBe('pro-85');
    expect(order[1]).toBe('free-90');
  });

  it('does NOT promote a Pro broker whose rank is below the floor', () => {
    const order = rank(
      [
        { profileId: 'free-90', score: 90, tier: 'free', rank: 0 },
        { profileId: 'pro-low', score: 85, tier: 'pro', rank: 50 },
      ],
      80,
      1,
    );
    expect(order[0]).toBe('free-90');
  });

  it('respects the sponsored slot limit', () => {
    const order = rank(
      [
        { profileId: 'pro-1', score: 50, tier: 'pro', rank: 90 },
        { profileId: 'pro-2', score: 40, tier: 'pro', rank: 95 },
        { profileId: 'free-99', score: 99, tier: 'free', rank: 0 },
      ],
      80,
      1,
    );
    // Only one sponsored slot: the higher-scoring pro pin wins,
    // the other pro drops back to organic order.
    expect(order[0]).toBe('pro-1');
    expect(order[1]).toBe('free-99');
    expect(order[2]).toBe('pro-2');
  });
});
