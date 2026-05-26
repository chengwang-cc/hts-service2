import { RuleReviewAlertService } from './rule-review-alert.service';
import type { RuleReviewAlertEntity } from '../entities/rule-review-alert.entity';

class FakeRepo {
  rows: RuleReviewAlertEntity[] = [];
  private seq = 0;

  create(partial: Partial<RuleReviewAlertEntity>): RuleReviewAlertEntity {
    return { ...(partial as RuleReviewAlertEntity) };
  }

  async findOne(opts: { where: Partial<RuleReviewAlertEntity> }) {
    const matcher = (r: RuleReviewAlertEntity) =>
      Object.entries(opts.where).every(([k, v]) => (r as any)[k] === v);
    return this.rows.find(matcher) ?? null;
  }

  async find(opts: { where: Partial<RuleReviewAlertEntity>; order?: Record<string, string>; take?: number }) {
    const matcher = (r: RuleReviewAlertEntity) =>
      Object.entries(opts.where).every(([k, v]) => (r as any)[k] === v);
    const filtered = this.rows.filter(matcher);
    if (opts.order?.createdAt === 'DESC') {
      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return opts.take ? filtered.slice(0, opts.take) : filtered;
  }

  async save(row: RuleReviewAlertEntity) {
    if (!row.id) {
      row.id = `alert-${++this.seq}`;
      row.createdAt = new Date();
      row.updatedAt = new Date();
      this.rows.push(row);
    } else {
      const i = this.rows.findIndex((r) => r.id === row.id);
      if (i >= 0) this.rows[i] = row;
      else this.rows.push(row);
    }
    return row;
  }

  async update(where: Partial<RuleReviewAlertEntity>, updates: Record<string, unknown>) {
    const row = await this.findOne({ where });
    if (row) Object.assign(row, updates);
  }

  createQueryBuilder() {
    let where: any[] = [];
    const self = this;
    const qb: any = {
      where(_clause: string, params: any) { where.push(params); return qb; },
      andWhere(_clause: string, params: any) { where.push(params); return qb; },
      orderBy() { return qb; },
      async getMany() {
        // Return rows matching status open AND createdAt >= since
        return self.rows.filter(
          (r) => r.status === 'open' && r.createdAt >= (where[1]?.since ?? new Date(0)),
        );
      },
    };
    return qb;
  }
}

describe('RuleReviewAlertService', () => {
  let repo: FakeRepo;
  let svc: RuleReviewAlertService;

  beforeEach(() => {
    repo = new FakeRepo();
    svc = new RuleReviewAlertService(repo as any);
  });

  it('opens a new alert', async () => {
    const a = await svc.openAlert({
      ruleId: 'us.r1', cardKey: 'cbp.csms.1',
      previousHash: 'a'.repeat(64), newHash: 'b'.repeat(64),
    });
    expect(a.status).toBe('open');
    expect(repo.rows).toHaveLength(1);
  });

  it('idempotent on (ruleId, newHash)', async () => {
    await svc.openAlert({
      ruleId: 'us.r1', cardKey: 'cbp.csms.1',
      previousHash: null, newHash: 'c'.repeat(64),
    });
    await svc.openAlert({
      ruleId: 'us.r1', cardKey: 'cbp.csms.1',
      previousHash: null, newHash: 'c'.repeat(64),
    });
    expect(repo.rows).toHaveLength(1);
  });

  it('lists open + listByRule', async () => {
    await svc.openAlert({ ruleId: 'us.r1', cardKey: 'k1', previousHash: null, newHash: 'h1'.repeat(32) });
    await svc.openAlert({ ruleId: 'us.r2', cardKey: 'k1', previousHash: null, newHash: 'h2'.repeat(32) });
    expect((await svc.listOpen()).length).toBe(2);
    expect((await svc.listByRule('us.r1')).length).toBe(1);
  });

  it('resolves with dismissed status', async () => {
    const a = await svc.openAlert({
      ruleId: 'us.r1', cardKey: 'k', previousHash: null, newHash: 'x'.repeat(64),
    });
    const r = await svc.resolve({ id: a.id, status: 'dismissed', actor: 'tester', note: 'no impact' });
    expect(r.status).toBe('dismissed');
    expect(r.resolvedBy).toBe('tester');
    expect(r.resolutionNote).toBe('no impact');
  });

  it('attachAdvisory writes AI council output', async () => {
    const a = await svc.openAlert({
      ruleId: 'us.r1', cardKey: 'k', previousHash: null, newHash: 'y'.repeat(64),
    });
    const r = await svc.attachAdvisory(a.id, { hint: 'review §232 scope expansion' });
    expect(r.aiAdvisoryJson).toEqual({ hint: 'review §232 scope expansion' });
  });
});
