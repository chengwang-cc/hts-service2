import { KnowledgeCardService } from './knowledge-card.service';
import type { KnowledgeCardEntity } from '../entities/knowledge-card.entity';

/**
 * Minimal in-memory repository stand-in. Just enough surface for the
 * service's reads/writes.
 */
class FakeRepo {
  rows: KnowledgeCardEntity[] = [];
  private seq = 0;

  create(partial: Partial<KnowledgeCardEntity>): KnowledgeCardEntity {
    return { ...(partial as KnowledgeCardEntity) };
  }

  async findOne(opts: { where: Partial<KnowledgeCardEntity> }): Promise<KnowledgeCardEntity | null> {
    const matcher = (r: KnowledgeCardEntity) =>
      Object.entries(opts.where).every(([k, v]) => (r as any)[k] === v);
    return this.rows.find(matcher) ?? null;
  }

  async find(opts: {
    where: Partial<KnowledgeCardEntity>;
    order?: Record<string, string>;
    take?: number;
  }): Promise<KnowledgeCardEntity[]> {
    // Stricter than real TypeORM only in that we explicitly do NOT
    // wildcard the empty string — exactly mirrors the bug the H3
    // regression spec exercises (old code passed `cardKey: ''`).
    const matcher = (r: KnowledgeCardEntity) =>
      Object.entries(opts.where).every(([k, v]) => v === undefined || (r as any)[k] === v);
    const filtered = this.rows.filter(matcher);
    if (opts.order?.createdAt === 'DESC') {
      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } else if (opts.order?.updatedAt === 'DESC') {
      filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }
    return opts.take ? filtered.slice(0, opts.take) : filtered;
  }

  async save(row: KnowledgeCardEntity): Promise<KnowledgeCardEntity> {
    if (!row.id) {
      row.id = `card-${++this.seq}`;
      row.createdAt = new Date();
      row.updatedAt = new Date();
      this.rows.push(row);
    } else {
      const i = this.rows.findIndex((r) => r.id === row.id);
      if (i >= 0) {
        row.updatedAt = new Date();
        this.rows[i] = row;
      } else this.rows.push(row);
    }
    return row;
  }

  async update(where: Partial<KnowledgeCardEntity>, updates: Record<string, unknown>): Promise<void> {
    const row = await this.findOne({ where });
    if (row) Object.assign(row, updates);
  }
}

describe('KnowledgeCardService', () => {
  let repo: FakeRepo;
  let svc: KnowledgeCardService;

  beforeEach(() => {
    repo = new FakeRepo();
    svc = new KnowledgeCardService(repo as any);
  });

  it('first ingest → inserted status active', async () => {
    const r = await svc.upsert({
      cardKey: 'test.k.1',
      documentType: 'csms',
      text: 'First body',
      payload: { text: 'First body' },
    });
    expect(r.outcome).toBe('inserted');
    expect(r.card.status).toBe('active');
    expect(r.card.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('same content → unchanged (idempotent)', async () => {
    await svc.upsert({
      cardKey: 'test.k.2', documentType: 'csms', text: 'Same body',
      payload: { text: 'Same body' },
    });
    const r = await svc.upsert({
      cardKey: 'test.k.2', documentType: 'csms', text: 'Same body',
      payload: { text: 'Same body' },
    });
    expect(r.outcome).toBe('unchanged');
  });

  it('different content → supersedes prior, status pending_review', async () => {
    const first = await svc.upsert({
      cardKey: 'test.k.3', documentType: 'csms', text: 'Original',
      payload: { text: 'Original' },
    });
    const second = await svc.upsert({
      cardKey: 'test.k.3', documentType: 'csms', text: 'Updated',
      payload: { text: 'Updated' },
    });
    expect(second.outcome).toBe('superseded');
    expect(second.card.status).toBe('pending_review');
    expect(second.previousCard?.id).toBe(first.card.id);
    // Prior row should now be marked superseded
    const history = await svc.history('test.k.3');
    const prior = history.find((c) => c.id === first.card.id);
    expect(prior?.status).toBe('superseded');
  });

  it('fires onCardChanged listener with previous+current', async () => {
    const events: Array<{ cardKey: string; prevHash: string | null; newHash: string }> = [];
    svc.onCardChanged((e) => {
      events.push({
        cardKey: e.cardKey,
        prevHash: e.previous?.contentHash ?? null,
        newHash: e.current.contentHash,
      });
    });
    await svc.upsert({
      cardKey: 'test.k.4', documentType: 'csms', text: 'v1',
      payload: { text: 'v1' },
    });
    await svc.upsert({
      cardKey: 'test.k.4', documentType: 'csms', text: 'v2',
      payload: { text: 'v2' },
    });
    expect(events).toHaveLength(2);
    expect(events[0].prevHash).toBeNull();
    expect(events[1].prevHash).toBe(events[0].newHash);
  });

  it('promoteToActive: pending_review → active; demotes prior active', async () => {
    await svc.upsert({
      cardKey: 'test.k.5', documentType: 'csms', text: 'v1',
      payload: { text: 'v1' },
    });
    const second = await svc.upsert({
      cardKey: 'test.k.5', documentType: 'csms', text: 'v2',
      payload: { text: 'v2' },
    });
    const promoted = await svc.promoteToActive(second.card.id, 'tester');
    expect(promoted.status).toBe('active');
  });

  it('hashContent is whitespace-insensitive within body', () => {
    const h1 = KnowledgeCardService.hashContent('Hello   World');
    const h2 = KnowledgeCardService.hashContent('Hello World');
    expect(h1).toBe(h2);
  });

  it('listActive returns active cards regardless of cardKey (regression for H3)', async () => {
    await svc.upsert({
      cardKey: 'list.k.1',
      documentType: 'csms',
      text: 'v1',
      payload: { text: 'v1' },
    });
    await svc.upsert({
      cardKey: 'list.k.2',
      documentType: 'csms',
      text: 'v2',
      payload: { text: 'v2' },
    });
    // history('') against the stricter fake returns []
    expect(await svc.history('')).toHaveLength(0);
    const listed = await svc.listActive(10);
    expect(listed).toHaveLength(2);
    expect(listed.every((c) => c.status === 'active')).toBe(true);
  });

  it('promoteToActive throws NotFoundException when no card matches', async () => {
    const { NotFoundException } = require('@nestjs/common');
    await expect(svc.promoteToActive('missing-id', 'tester')).rejects.toThrow(
      NotFoundException,
    );
  });
});

/**
 * M4 (deep-review 2026-05-27): cover the pg-boss `card.updated` path.
 * When KB_CARD_EVENTS_VIA_QUEUE=true the service should publish via
 * QueueService.sendJob instead of invoking in-process listeners.
 */
describe('KnowledgeCardService — M4 queue path', () => {
  const originalEnv = process.env.KB_CARD_EVENTS_VIA_QUEUE;
  beforeAll(() => {
    process.env.KB_CARD_EVENTS_VIA_QUEUE = 'true';
  });
  afterAll(() => {
    if (originalEnv === undefined) delete process.env.KB_CARD_EVENTS_VIA_QUEUE;
    else process.env.KB_CARD_EVENTS_VIA_QUEUE = originalEnv;
  });

  it('publishes to the queue on supersede and does NOT invoke in-process listeners', async () => {
    const repo = new FakeRepo();
    const sent: Array<{ queue: string; data: any }> = [];
    const fakeQueue = {
      async sendJob(queue: string, data: any) {
        sent.push({ queue, data });
        return 'job-1';
      },
    };
    const svc = new KnowledgeCardService(repo as any, fakeQueue as any);
    const listenerHits: string[] = [];
    svc.onCardChanged(() => {
      listenerHits.push('hit');
    });
    await svc.upsert({
      cardKey: 'm4.k.1', documentType: 'csms', text: 'v1',
      payload: { text: 'v1' },
    });
    await svc.upsert({
      cardKey: 'm4.k.1', documentType: 'csms', text: 'v2',
      payload: { text: 'v2' },
    });
    expect(listenerHits).toEqual([]);
    expect(sent).toHaveLength(2);
    expect(sent[0].queue).toBe('card.updated');
    expect(sent[0].data.previousId).toBeNull();
    expect(sent[1].data.previousId).toBe(sent[0].data.currentId);
    expect(sent[1].data.newHash).not.toEqual(sent[0].data.newHash);
  });

  it('swallows queue failures so the upsert still succeeds', async () => {
    const repo = new FakeRepo();
    const fakeQueue = {
      async sendJob() {
        throw new Error('queue down');
      },
    };
    const svc = new KnowledgeCardService(repo as any, fakeQueue as any);
    // Should not throw; should still return the new card.
    const result = await svc.upsert({
      cardKey: 'm4.k.2', documentType: 'csms', text: 'v1',
      payload: { text: 'v1' },
    });
    expect(result.outcome).toBe('inserted');
    expect(result.card.cardKey).toBe('m4.k.2');
  });
});
