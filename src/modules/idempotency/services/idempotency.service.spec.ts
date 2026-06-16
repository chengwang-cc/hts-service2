import { ConflictException } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyKeyEntity } from '../entities/idempotency-key.entity';

const makeRepo = (initial: Partial<IdempotencyKeyEntity>[] = []): any => {
  const rows: any[] = initial.map((r) => ({ ...r }));
  return {
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) => r.scope === where.scope && r.key === where.key) ?? null,
    ),
    create: jest.fn((data: any) => ({ ...data, id: `i-${rows.length + 1}` })),
    save: jest.fn(async (entity: any) => {
      // emulate the unique (scope, key) constraint
      const existing = rows.find(
        (r) => r.scope === entity.scope && r.key === entity.key,
      );
      if (existing) throw new Error('duplicate key value violates unique constraint');
      rows.push(entity);
      return entity;
    }),
    delete: jest.fn(async ({ id }: any) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    }),
    _rows: rows,
  };
};

describe('IdempotencyService.hashRequest', () => {
  const svc = new IdempotencyService({} as any);

  it('produces stable hashes for the same body', () => {
    const a = svc.hashRequest('POST', '/batch/jobs', { x: 1, y: 'hi' });
    const b = svc.hashRequest('POST', '/batch/jobs', { x: 1, y: 'hi' });
    expect(a).toBe(b);
  });

  it('is invariant to key order in nested objects', () => {
    const a = svc.hashRequest('POST', '/batch/jobs', { a: 1, b: { x: 1, y: 2 } });
    const b = svc.hashRequest('POST', '/batch/jobs', { b: { y: 2, x: 1 }, a: 1 });
    expect(a).toBe(b);
  });

  it('IS sensitive to array order (item order matters in a batch)', () => {
    const a = svc.hashRequest('POST', '/batch/jobs', { items: [1, 2, 3] });
    const b = svc.hashRequest('POST', '/batch/jobs', { items: [3, 2, 1] });
    expect(a).not.toBe(b);
  });

  it('is sensitive to HTTP method', () => {
    const a = svc.hashRequest('POST', '/p', {});
    const b = svc.hashRequest('PUT', '/p', {});
    expect(a).not.toBe(b);
  });

  it('is sensitive to path', () => {
    const a = svc.hashRequest('POST', '/p', {});
    const b = svc.hashRequest('POST', '/q', {});
    expect(a).not.toBe(b);
  });
});

describe('IdempotencyService.lookup', () => {
  it('returns null on a miss', async () => {
    const svc = new IdempotencyService(makeRepo());
    const r = await svc.lookup({ scope: 's', key: 'k', requestHash: 'h' });
    expect(r).toBeNull();
  });

  it('returns the cached response on a hit', async () => {
    const repo = makeRepo([
      {
        id: 'i-1',
        scope: 's',
        key: 'k',
        requestHash: 'h',
        statusCode: 201,
        responseBody: { ok: true },
        createdAt: new Date(),
      },
    ]);
    const svc = new IdempotencyService(repo);
    const r = await svc.lookup({ scope: 's', key: 'k', requestHash: 'h' });
    expect(r).toEqual({ statusCode: 201, body: { ok: true } });
  });

  it('throws 409 when the row exists but request hash differs', async () => {
    const repo = makeRepo([
      {
        id: 'i-1',
        scope: 's',
        key: 'k',
        requestHash: 'h-original',
        statusCode: 201,
        responseBody: { ok: true },
        createdAt: new Date(),
      },
    ]);
    const svc = new IdempotencyService(repo);
    await expect(
      svc.lookup({ scope: 's', key: 'k', requestHash: 'h-different' }),
    ).rejects.toThrow(ConflictException);
  });

  it('treats expired rows as a miss + sweeps them', async () => {
    const expired = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const repo = makeRepo([
      {
        id: 'i-1',
        scope: 's',
        key: 'k',
        requestHash: 'h',
        statusCode: 200,
        responseBody: { ok: true },
        createdAt: expired,
      },
    ]);
    const svc = new IdempotencyService(repo);
    const r = await svc.lookup({ scope: 's', key: 'k', requestHash: 'h' });
    expect(r).toBeNull();
    expect(repo.delete).toHaveBeenCalledWith({ id: 'i-1' });
  });
});

describe('IdempotencyService.save', () => {
  it('persists a fresh entry', async () => {
    const repo = makeRepo();
    const svc = new IdempotencyService(repo);
    await svc.save({
      scope: 's',
      key: 'k',
      requestHash: 'h',
      organizationId: 'org-1',
      statusCode: 201,
      body: { id: 'job-1' },
    });
    expect(repo._rows).toHaveLength(1);
    expect(repo._rows[0]).toMatchObject({
      scope: 's',
      key: 'k',
      statusCode: 201,
      organizationId: 'org-1',
    });
  });

  it('swallows the duplicate-insert error on a race (returns void, no throw)', async () => {
    const repo = makeRepo([
      {
        id: 'i-1',
        scope: 's',
        key: 'k',
        requestHash: 'h',
        statusCode: 200,
        responseBody: { ok: true },
        createdAt: new Date(),
      },
    ]);
    const svc = new IdempotencyService(repo);
    await expect(
      svc.save({
        scope: 's',
        key: 'k',
        requestHash: 'h',
        organizationId: null,
        statusCode: 200,
        body: { ok: true },
      }),
    ).resolves.toBeUndefined();
  });
});
