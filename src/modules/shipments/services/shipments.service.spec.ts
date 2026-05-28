import { ConflictException, NotFoundException } from '@nestjs/common';
import { ShipmentsService, ShipmentsCtx } from './shipments.service';
import type { SavedShipmentEntity } from '../entities/saved-shipment.entity';
import type { SavedShipmentQuoteSnapshotEntity } from '../entities/saved-shipment-quote-snapshot.entity';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const USER_1 = '33333333-3333-3333-3333-333333333333';
const USER_2 = '44444444-4444-4444-4444-444444444444';

interface FakeRow extends SavedShipmentEntity {}

function mkRow(overrides: Partial<FakeRow> = {}): FakeRow {
  const now = new Date('2026-05-27T10:00:00.000Z');
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    organizationId: ORG_A,
    createdByUserId: USER_1,
    name: 'Test',
    description: null,
    status: 'draft',
    tags: [],
    sharedWithOrg: false,
    shipment: { destination: 'US', currency: 'USD' },
    lines: [],
    lastQuoteSnapshot: null,
    lastOpenedAt: now,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as FakeRow;
}

/**
 * Minimal in-memory store backing the two repository interfaces used by
 * ShipmentsService. Only models the surface the service exercises; not a
 * full TypeORM clone.
 */
function buildService() {
  let shipments: FakeRow[] = [];
  let snapshots: SavedShipmentQuoteSnapshotEntity[] = [];

  const matchScope = (s: FakeRow, ctx: ShipmentsCtx) =>
    s.organizationId === ctx.organizationId &&
    (s.createdByUserId === ctx.userId || s.sharedWithOrg);

  function makeQueryBuilder(rows: () => FakeRow[]) {
    const predicates: Array<(s: FakeRow) => boolean> = [];
    let _order: { col: string; dir: 'ASC' | 'DESC' } | null = null;
    let _skip = 0;
    let _take = 1000;
    const qb: any = {
      where: jest.fn((sql: string, params: Record<string, unknown> = {}) => {
        applyPredicate(sql, params, predicates);
        return qb;
      }),
      andWhere: jest.fn((sql: any, params: Record<string, unknown> = {}) => {
        // TypeORM Brackets — { whereFactory: (qb) => void }. We invoke the
        // factory against a fake sub-builder that OR-combines its predicates.
        const factory =
          typeof sql === 'function'
            ? sql
            : sql && typeof sql.whereFactory === 'function'
              ? sql.whereFactory
              : null;
        if (factory) {
          const subPreds: Array<(s: FakeRow) => boolean> = [];
          const sub: any = {
            where: (s: string, p: Record<string, unknown> = {}) => {
              applyPredicate(s, p, subPreds);
              return sub;
            },
            orWhere: (s: string, p: Record<string, unknown> = {}) => {
              applyPredicate(s, p, subPreds);
              return sub;
            },
          };
          factory(sub);
          predicates.push((r) => subPreds.some((p) => p(r)));
        } else {
          applyPredicate(sql as string, params, predicates);
        }
        return qb;
      }),
      orderBy: jest.fn((col: string, dir: 'ASC' | 'DESC') => {
        _order = { col, dir };
        return qb;
      }),
      skip: jest.fn((n: number) => {
        _skip = n;
        return qb;
      }),
      take: jest.fn((n: number) => {
        _take = n;
        return qb;
      }),
      getOne: jest.fn(async () => {
        const matched = rows().filter((r) => predicates.every((p) => p(r)));
        return matched[0] ?? null;
      }),
      getMany: jest.fn(async () => {
        let matched = rows().filter((r) => predicates.every((p) => p(r)));
        if (_order) {
          const key = _order.col.replace(/^s\./, '');
          matched = [...matched].sort((a: any, b: any) => {
            const av = a[key];
            const bv = b[key];
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return _order!.dir === 'ASC' ? cmp : -cmp;
          });
        }
        return matched.slice(_skip, _skip + _take);
      }),
      getManyAndCount: jest.fn(async () => {
        const matched = rows().filter((r) => predicates.every((p) => p(r)));
        let ordered = matched;
        if (_order) {
          const key = _order.col.replace(/^s\./, '');
          ordered = [...matched].sort((a: any, b: any) => {
            const av = a[key];
            const bv = b[key];
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return _order!.dir === 'ASC' ? cmp : -cmp;
          });
        }
        return [ordered.slice(_skip, _skip + _take), matched.length];
      }),
    };
    return qb;
  }

  // Translates the small SQL surface we generate into predicates. Only the
  // shapes used by ShipmentsService are recognised; anything else is treated
  // as a no-op so it can't silently let false positives through.
  function applyPredicate(
    sql: string,
    params: Record<string, unknown>,
    bucket: Array<(s: FakeRow) => boolean>,
  ) {
    const s = sql.trim();
    if (s.includes('s.organizationId = :org')) {
      bucket.push((r) => r.organizationId === params.org);
    } else if (s.includes('s.createdByUserId = :uid')) {
      bucket.push((r) => r.createdByUserId === params.uid);
    } else if (s.includes('s.sharedWithOrg = true')) {
      bucket.push((r) => r.sharedWithOrg === true);
    } else if (s.includes('s.id = :id')) {
      bucket.push((r) => r.id === params.id);
    } else if (s.includes('s.status = :status')) {
      bucket.push((r) => r.status === params.status);
    } else if (s.includes('s.status != :archivedStatus')) {
      bucket.push((r) => r.status !== params.archivedStatus);
    } else if (s.includes("s.shipment->>'destination' = :dest")) {
      bucket.push((r) => (r.shipment as any).destination === params.dest);
    } else if (s.includes(':tag = ANY(s.tags)')) {
      bucket.push((r) => r.tags.includes(params.tag as string));
    } else if (s.includes('s.name ILIKE :like')) {
      const like = String(params.like).replace(/%/g, '');
      bucket.push((r) => r.name.toLowerCase().includes(like.toLowerCase()));
    } else if (s.includes("COALESCE(s.description, '') ILIKE :like")) {
      const like = String(params.like).replace(/%/g, '');
      bucket.push((r) =>
        (r.description ?? '').toLowerCase().includes(like.toLowerCase()),
      );
    } else if (s.includes("line->>'htsNumber' ILIKE :like")) {
      const like = String(params.like).replace(/%/g, '');
      bucket.push((r) =>
        r.lines.some((l) =>
          String((l as any).htsNumber ?? '')
            .toLowerCase()
            .includes(like.toLowerCase()),
        ),
      );
    }
  }

  let idCounter = 100;
  const shipmentRepo: any = {
    create: jest.fn((data: Partial<FakeRow>) => {
      const id =
        data.id ?? `aaaaaaaa-aaaa-aaaa-aaaa-${String(idCounter++).padStart(12, '0')}`;
      return mkRow({ ...data, id });
    }),
    save: jest.fn(async (entity: FakeRow) => {
      const idx = shipments.findIndex((s) => s.id === entity.id);
      const now = new Date();
      if (idx === -1) {
        const row = { ...entity, createdAt: entity.createdAt ?? now, updatedAt: now };
        shipments.push(row);
        return row;
      }
      shipments[idx] = { ...shipments[idx], ...entity, updatedAt: now };
      return shipments[idx];
    }),
    count: jest.fn(async ({ where }: any) => {
      return shipments.filter((s) =>
        Object.entries(where).every(([k, v]) => (s as any)[k] === v),
      ).length;
    }),
    update: jest.fn(async (criteria: any, patch: Partial<FakeRow>) => {
      shipments = shipments.map((s) => {
        const matches = Object.entries(criteria).every(
          ([k, v]) => (s as any)[k] === v,
        );
        return matches ? { ...s, ...patch } : s;
      });
      return { affected: 1 };
    }),
    createQueryBuilder: jest.fn(() => makeQueryBuilder(() => shipments)),
  };

  const snapshotRepo: any = {
    create: jest.fn((data: any) => ({
      id: 'snap-' + Math.random().toString(36).slice(2, 10),
      ...data,
      createdAt: new Date(),
    })),
    save: jest.fn(async (entity: any) => {
      snapshots.push(entity);
      return entity;
    }),
    findAndCount: jest.fn(async ({ where, skip = 0, take = 20 }: any) => {
      const matched = snapshots.filter((s) =>
        Object.entries(where).every(([k, v]) => (s as any)[k] === v),
      );
      return [matched.slice(skip, skip + take), matched.length];
    }),
  };

  return {
    service: new ShipmentsService(shipmentRepo, snapshotRepo),
    shipmentRepo,
    snapshotRepo,
    state: () => ({ shipments, snapshots }),
    seed: (row: Partial<FakeRow>) => {
      const r = mkRow(row);
      shipments.push(r);
      return r;
    },
  };
}

describe('ShipmentsService', () => {
  describe('tenant isolation', () => {
    it('refuses to return another organization\'s shipment by id', async () => {
      const t = buildService();
      const row = t.seed({ organizationId: ORG_B, createdByUserId: USER_2 });

      await expect(
        t.service.findOne({ organizationId: ORG_A, userId: USER_1 }, row.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to return another user\'s shipment in the same org when not sharedWithOrg', async () => {
      const t = buildService();
      const row = t.seed({ organizationId: ORG_A, createdByUserId: USER_2, sharedWithOrg: false });

      await expect(
        t.service.findOne({ organizationId: ORG_A, userId: USER_1 }, row.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns a same-org sharedWithOrg=true shipment for non-creators', async () => {
      const t = buildService();
      const row = t.seed({
        organizationId: ORG_A,
        createdByUserId: USER_2,
        sharedWithOrg: true,
      });

      const found = await t.service.findOne(
        { organizationId: ORG_A, userId: USER_1 },
        row.id,
        false,
      );
      expect(found.id).toBe(row.id);
    });

    it('blocks updates from a shared-with-org reader (write requires creator)', async () => {
      const t = buildService();
      const row = t.seed({
        organizationId: ORG_A,
        createdByUserId: USER_2,
        sharedWithOrg: true,
      });

      await expect(
        t.service.update(
          { organizationId: ORG_A, userId: USER_1 },
          row.id,
          { name: 'hijacked' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create + list + search', () => {
    it('persists a new shipment scoped to the caller', async () => {
      const t = buildService();
      const created = await t.service.create(
        { organizationId: ORG_A, userId: USER_1 },
        {
          name: 'CA→US — March order',
          shipment: { destination: 'US' },
          lines: [{ htsNumber: '7318.15.4080' }],
        },
      );

      expect(created.organizationId).toBe(ORG_A);
      expect(created.createdByUserId).toBe(USER_1);
      expect(created.status).toBe('draft');
      expect(t.state().shipments).toHaveLength(1);
    });

    it('list() filters by destination and free-text q across lines', async () => {
      const t = buildService();
      const ctx = { organizationId: ORG_A, userId: USER_1 };
      t.seed({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
        organizationId: ORG_A,
        createdByUserId: USER_1,
        name: 'CA→US order',
        shipment: { destination: 'US' },
        lines: [{ htsNumber: '7318.15.4080', description: 'stainless bolt' }],
      });
      t.seed({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
        organizationId: ORG_A,
        createdByUserId: USER_1,
        name: 'CA→GB order',
        shipment: { destination: 'GB' },
        lines: [{ htsNumber: '8302.49.6085' }],
      });

      const result = await t.service.list(ctx, { destination: 'US' });
      expect(result.total).toBe(1);
      expect(result.items[0].name).toContain('US');

      const byCode = await t.service.list(ctx, { q: '8302' });
      expect(byCode.total).toBe(1);
      expect(byCode.items[0].shipment).toEqual({ destination: 'GB' });
    });

    it('list() excludes archived rows unless status=archived is requested', async () => {
      const t = buildService();
      const ctx = { organizationId: ORG_A, userId: USER_1 };
      t.seed({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10', name: 'draft a' });
      t.seed({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11',
        name: 'archived b',
        status: 'archived',
      });

      const def = await t.service.list(ctx, {});
      expect(def.total).toBe(1);
      expect(def.items[0].name).toBe('draft a');

      const arch = await t.service.list(ctx, { status: 'archived' });
      expect(arch.total).toBe(1);
      expect(arch.items[0].name).toBe('archived b');
    });
  });

  describe('update / optimistic concurrency', () => {
    it('throws ConflictException when If-Match updatedAt does not match', async () => {
      const t = buildService();
      const row = t.seed({
        organizationId: ORG_A,
        createdByUserId: USER_1,
        updatedAt: new Date('2026-05-27T10:00:00.000Z'),
      });

      const stale = new Date('2026-05-27T09:00:00.000Z');
      await expect(
        t.service.update(
          { organizationId: ORG_A, userId: USER_1 },
          row.id,
          { name: 'renamed' },
          stale,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('applies the patch when If-Match matches the current updatedAt', async () => {
      const t = buildService();
      const row = t.seed({
        organizationId: ORG_A,
        createdByUserId: USER_1,
        updatedAt: new Date('2026-05-27T10:00:00.000Z'),
      });

      const updated = await t.service.update(
        { organizationId: ORG_A, userId: USER_1 },
        row.id,
        { name: 'renamed' },
        new Date('2026-05-27T10:00:00.000Z'),
      );

      expect(updated.name).toBe('renamed');
    });

    it('archive sets status=archived and stamps archivedAt', async () => {
      const t = buildService();
      const row = t.seed({ organizationId: ORG_A, createdByUserId: USER_1 });

      const after = await t.service.archive(
        { organizationId: ORG_A, userId: USER_1 },
        row.id,
      );

      expect(after.status).toBe('archived');
      expect(after.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe('duplicate', () => {
    it('clones the source into a new draft owned by the caller', async () => {
      const t = buildService();
      const row = t.seed({
        organizationId: ORG_A,
        createdByUserId: USER_1,
        name: 'original',
        tags: ['Q1'],
      });

      const copy = await t.service.duplicate(
        { organizationId: ORG_A, userId: USER_1 },
        row.id,
      );

      expect(copy.id).not.toBe(row.id);
      expect(copy.name).toBe('original (copy)');
      expect(copy.status).toBe('draft');
      expect(copy.tags).toEqual(['Q1']);
      expect(copy.lastQuoteSnapshot).toBeNull();
    });
  });

  describe('snapshots', () => {
    it('records a snapshot and refreshes lastQuoteSnapshot summary', async () => {
      const t = buildService();
      const row = t.seed({ organizationId: ORG_A, createdByUserId: USER_1 });

      const snap = await t.service.recordSnapshot(
        { organizationId: ORG_A, userId: USER_1 },
        row.id,
        {
          quoteRequest: { foo: 1 },
          quoteResponse: { totals: { payable: 1234.5 } },
          payable: 1234.5,
          currency: 'USD',
        },
      );

      expect(snap.id).toBeDefined();
      expect(t.state().snapshots).toHaveLength(1);
      expect(t.shipmentRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: row.id, organizationId: ORG_A }),
        expect.objectContaining({
          lastQuoteSnapshot: expect.objectContaining({
            payable: 1234.5,
            currency: 'USD',
          }),
        }),
      );
    });

    it('listSnapshots scopes by org + saved_shipment_id', async () => {
      const t = buildService();
      const row = t.seed({ organizationId: ORG_A, createdByUserId: USER_1 });
      await t.service.recordSnapshot(
        { organizationId: ORG_A, userId: USER_1 },
        row.id,
        { quoteRequest: {}, quoteResponse: {} },
      );

      const result = await t.service.listSnapshots(
        { organizationId: ORG_A, userId: USER_1 },
        row.id,
      );
      expect(result.total).toBe(1);
    });
  });
});
