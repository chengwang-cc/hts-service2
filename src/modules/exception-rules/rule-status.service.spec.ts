import { RuleStatusService } from './rule-status.service';
import type { RuleStatusEntity } from './entities/rule-status.entity';

/**
 * In-memory stand-in for the TypeORM Repository<RuleStatusEntity>.
 * Just enough surface for the service's reads/writes.
 */
class FakeRepo {
  rows: RuleStatusEntity[] = [];
  async find() { return this.rows.slice(); }
  async findOne(opts: { where: { ruleId: string } }) {
    return this.rows.find((r) => r.ruleId === opts.where.ruleId);
  }
  create(partial: Partial<RuleStatusEntity>) {
    return { ...partial } as RuleStatusEntity;
  }
  async save(row: RuleStatusEntity) {
    const i = this.rows.findIndex((r) => r.ruleId === row.ruleId);
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
    return row;
  }
}

describe('RuleStatusService', () => {
  let repo: FakeRepo;
  let svc: RuleStatusService;

  beforeEach(() => {
    repo = new FakeRepo();
    svc = new RuleStatusService(repo as any);
  });

  it('defaults to enabled when no row exists', async () => {
    expect(await svc.isEnabled('any.rule')).toBe(true);
  });

  it('respects an explicitly-disabled row', async () => {
    await svc.set({ ruleId: 'r', enabled: false, changedBy: 'tester' });
    expect(await svc.isEnabled('r')).toBe(false);
  });

  it('re-enables when set true after being set false', async () => {
    await svc.set({ ruleId: 'r', enabled: false, changedBy: 'tester' });
    await svc.set({ ruleId: 'r', enabled: true, changedBy: 'tester' });
    expect(await svc.isEnabled('r')).toBe(true);
  });

  it('honors future effectiveFrom (rule not yet active)', async () => {
    const future = new Date(Date.now() + 86_400_000);
    await svc.set({
      ruleId: 'r',
      enabled: true,
      effectiveFrom: future,
      changedBy: 'tester',
    });
    expect(await svc.isEnabled('r', new Date())).toBe(false);
    expect(await svc.isEnabled('r', new Date(future.getTime() + 1))).toBe(true);
  });

  it('honors past effectiveTo (rule retired)', async () => {
    const past = new Date(Date.now() - 86_400_000);
    await svc.set({
      ruleId: 'r',
      enabled: true,
      effectiveTo: past,
      changedBy: 'tester',
    });
    expect(await svc.isEnabled('r', new Date())).toBe(false);
    expect(await svc.isEnabled('r', new Date(past.getTime() - 1))).toBe(true);
  });

  it('bulkStatus returns a value per id', async () => {
    await svc.set({ ruleId: 'on', enabled: true, changedBy: 'tester' });
    await svc.set({ ruleId: 'off', enabled: false, changedBy: 'tester' });
    const map = await svc.bulkStatus(['on', 'off', 'untouched']);
    expect(map).toEqual({ on: true, off: false, untouched: true });
  });

  it('list() returns one summary per row', async () => {
    await svc.set({ ruleId: 'a', enabled: true, changedBy: 't' });
    await svc.set({
      ruleId: 'b',
      enabled: false,
      reason: 'paused for review',
      changedBy: 't',
    });
    const list = await svc.list();
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.ruleId === 'b')?.reason).toBe('paused for review');
  });

  it('returns enabled-by-default when constructed without a repo', async () => {
    const svc2 = new RuleStatusService(undefined as any);
    expect(await svc2.isEnabled('whatever')).toBe(true);
    await expect(
      svc2.set({ ruleId: 'x', enabled: false, changedBy: 't' }),
    ).rejects.toThrow(/repository unavailable/);
  });
});
