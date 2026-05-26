import { UsAdCvdRule } from '../us/ad-cvd.rule';
import { EuAdCvdRule } from '../eu/ad-cvd.rule';
import { AdCvdLookupService } from './ad-cvd-lookup.service';
import { AdCvdImporterService } from './ad-cvd-importer.service';
import type { AdCvdOrderEntity } from './ad-cvd-orders.entity';
import type { ExceptionRuleContext } from '../types';

/** Same FakeRepo as the importer spec. */
class FakeRepo {
  rows: AdCvdOrderEntity[] = [];
  private seq = 0;
  create(p: Partial<AdCvdOrderEntity>): AdCvdOrderEntity { return { ...(p as AdCvdOrderEntity) }; }
  async findOne(opts: { where: Partial<AdCvdOrderEntity> }) {
    return this.rows.find((r) =>
      Object.entries(opts.where).every(([k, v]) => (r as any)[k] === v),
    );
  }
  async save(row: AdCvdOrderEntity) {
    if (!row.id) {
      row.id = `o-${++this.seq}`;
      row.createdAt = new Date();
      row.updatedAt = new Date();
      this.rows.push(row);
    }
    return row;
  }
  async find(opts: { where: Partial<AdCvdOrderEntity> }) {
    return this.rows.filter((r) =>
      Object.entries(opts.where).every(([k, v]) => (r as any)[k] === v),
    );
  }
}

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '7222.30.0000',
    origin: 'CN',
    destination: 'US',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 10_000,
    currency: 'USD',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('AdCvdRuleBase (via UsAdCvdRule + EuAdCvdRule)', () => {
  let repo: FakeRepo;
  let lookup: AdCvdLookupService;
  let importer: AdCvdImporterService;

  beforeEach(async () => {
    repo = new FakeRepo();
    lookup = new AdCvdLookupService(repo as any);
    importer = new AdCvdImporterService(repo as any);
    await importer.loadSeedFile();
  });

  it('US: emits component for known order (all-others rate)', async () => {
    const rule = new UsAdCvdRule(lookup);
    expect(rule.isApplicable(ctx())).toBe(true);
    const d = await rule.evaluate(ctx());
    expect(d.add).toBeDefined();
    expect(d.add![0].formula).toBe('value * 0.2456');
    expect(d.add![0].identifier).toContain('US_AD_CVD_A_570_080');
  });

  it('US: per-exporter rate beats all-others', async () => {
    const rule = new UsAdCvdRule(lookup);
    const d = await rule.evaluate(
      ctx({ additionalInputs: { exporter_name: 'Baowu Special Materials' } }),
    );
    expect(d.add![0].formula).toBe('value * 0.0987');
    expect(d.add![0].description).toContain('Baowu Special Materials');
  });

  it('US: emits no component for HTS without an order', async () => {
    const rule = new UsAdCvdRule(lookup);
    const d = await rule.evaluate(ctx({ htsCode: '6109.10.0004' }));
    expect(d.add).toBeUndefined();
    expect(d.notes?.[0]).toMatch(/no AD\/CVD/);
  });

  it('US: not applicable for non-US destination', () => {
    const rule = new UsAdCvdRule(lookup);
    expect(rule.isApplicable(ctx({ destination: 'CA' }))).toBe(false);
  });

  it('EU: emits Russia order for HS 7301.10', async () => {
    const rule = new EuAdCvdRule(lookup);
    const d = await rule.evaluate(
      ctx({ destination: 'EU', origin: 'RU', htsCode: '7301.10.0000' }),
    );
    expect(d.add).toBeDefined();
    expect(d.add![0].formula).toBe('value * 0.18');
  });
});

describe('AdCvdLookupService', () => {
  let repo: FakeRepo;
  let lookup: AdCvdLookupService;

  beforeEach(async () => {
    repo = new FakeRepo();
    const importer = new AdCvdImporterService(repo as any);
    await importer.loadSeedFile();
    lookup = new AdCvdLookupService(repo as any);
  });

  it('returns null for unmatched destination', async () => {
    const m = await lookup.lookup({
      destinationCountry: 'XX',
      htsCode: '7222.30.0000',
      originCountry: 'CN',
    });
    expect(m).toBeNull();
  });

  it('respects asOf — order before effectiveFrom returns null', async () => {
    const m = await lookup.lookup({
      destinationCountry: 'US',
      htsCode: '7222.30.0000',
      originCountry: 'CN',
      asOf: new Date('2016-01-01'),
    });
    expect(m).toBeNull();
  });

  it('returns most-recent match for active orders', async () => {
    const m = await lookup.lookup({
      destinationCountry: 'EU',
      htsCode: '7208.10.0000',
      originCountry: 'CN',
    });
    expect(m).not.toBeNull();
    expect(m?.caseNumber).toBe('R-2018-160');
  });

  it('H1 (2026-05-26): inclusive effectiveTo — order still applies on the last day', async () => {
    const today = new Date('2026-05-26');
    // Inject a one-day order whose last effective day is exactly the
    // entry date. Lookup must include it.
    repo.rows.push({
      id: 'h1-1',
      destinationCountry: 'US',
      htsCode: '7222300000',
      originCountry: 'CN',
      exporterName: null,
      orderCaseNumber: 'H1-TEST',
      orderType: 'AD',
      cashDepositRate: 0.5,
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: today,
      source: 'h1.test',
      description: 'H1 boundary case',
      createdAt: today,
      updatedAt: today,
    } as any);
    const m = await lookup.lookup({
      destinationCountry: 'US',
      htsCode: '7222.30.0000',
      originCountry: 'CN',
      asOf: today,
    });
    expect(m?.caseNumber).toBe('H1-TEST');
  });

  it('H3 (2026-05-26): repeated lookups for the same (dest, origin) hit the DB once', async () => {
    // Spy on the underlying find call count.
    const findSpy = jest.spyOn(repo, 'find');
    await lookup.lookup({
      destinationCountry: 'US',
      htsCode: '7222.30.0000',
      originCountry: 'CN',
    });
    const calls1 = findSpy.mock.calls.length;
    await lookup.lookup({
      destinationCountry: 'US',
      htsCode: '7222.30.0000',
      originCountry: 'CN',
    });
    await lookup.lookup({
      destinationCountry: 'US',
      htsCode: '7222.30.0000',
      originCountry: 'CN',
    });
    const calls3 = findSpy.mock.calls.length;
    // First call hits the DB; subsequent two should be served from
    // the in-process row cache.
    expect(calls3).toBe(calls1);
    findSpy.mockRestore();
  });

  it('H3 (2026-05-26): invalidateCache forces the next lookup to re-query the DB', async () => {
    const findSpy = jest.spyOn(repo, 'find');
    await lookup.lookup({
      destinationCountry: 'US',
      htsCode: '7222.30.0000',
      originCountry: 'CN',
    });
    const before = findSpy.mock.calls.length;
    lookup.invalidateCache();
    await lookup.lookup({
      destinationCountry: 'US',
      htsCode: '7222.30.0000',
      originCountry: 'CN',
    });
    expect(findSpy.mock.calls.length).toBe(before + 1);
    findSpy.mockRestore();
  });

  it('H2 (2026-05-26): empty-string exporterName is treated as the all-others fallback', async () => {
    // Drop the seed-loaded rows and stage a per-exporter row at a low
    // rate + an empty-string "all-others" row at a high rate.
    repo.rows.splice(0);
    repo.rows.push(
      {
        id: 'h2-1',
        destinationCountry: 'US',
        htsCode: '7222300000',
        originCountry: 'CN',
        exporterName: 'BAOWU',
        orderCaseNumber: 'H2-TEST',
        orderType: 'AD',
        cashDepositRate: 0.1,
        effectiveFrom: new Date('2024-01-01'),
        effectiveTo: null,
        source: 'h2.test',
        description: 'per-exporter rate',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      {
        id: 'h2-2',
        destinationCountry: 'US',
        htsCode: '7222300000',
        originCountry: 'CN',
        exporterName: '', // empty string, not null
        orderCaseNumber: 'H2-TEST',
        orderType: 'AD',
        cashDepositRate: 0.5,
        effectiveFrom: new Date('2024-01-01'),
        effectiveTo: null,
        source: 'h2.test',
        description: 'all-others rate via empty string',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    );
    const m = await lookup.lookup({
      destinationCountry: 'US',
      htsCode: '7222.30.0000',
      originCountry: 'CN',
      // no exporterName → should pick the all-others row
    });
    expect(m?.rate).toBeCloseTo(0.5, 4);
    expect(m?.exporterName === '' || m?.exporterName === null).toBe(true);
  });
});
