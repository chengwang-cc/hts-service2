/**
 * Test helpers for broker-platform service tests. All helpers are pure (no
 * jest.mock side-effects), so individual specs can opt in.
 */
import type { Repository } from 'typeorm';

/** Build a Jest mock backed by an in-memory array that implements just
 *  enough of TypeORM Repository<T> for the broker services we exercise. */
export function createRepoMock<T extends { id?: string }>(
  initial: T[] = [],
): jest.Mocked<Pick<
  Repository<T>,
  | 'find'
  | 'findOne'
  | 'save'
  | 'create'
  | 'count'
  | 'update'
  | 'delete'
  | 'exist'
  | 'createQueryBuilder'
>> & { __store: T[] } {
  const store: T[] = [...initial];

  const matches = (row: T, where: any): boolean => {
    if (!where) return true;
    if (Array.isArray(where)) return where.some((w) => matches(row, w));
    for (const [key, value] of Object.entries(where)) {
      if ((row as any)[key] !== value) return false;
    }
    return true;
  };

  const findFn = jest.fn(async (opts?: any) => {
    if (!opts?.where) return [...store];
    const rows = store.filter((r) => matches(r, opts.where));
    return opts.take ? rows.slice(0, opts.take) : rows;
  });

  const findOneFn = jest.fn(async (opts?: any) => {
    if (!opts?.where) return store[0] ?? null;
    return store.find((r) => matches(r, opts.where)) ?? null;
  });

  const createFn = jest.fn((dto: Partial<T> = {}) => ({ ...dto } as T));

  const saveFn = jest.fn(async (entity: any) => {
    const rows = Array.isArray(entity) ? entity : [entity];
    const out: T[] = [];
    for (const row of rows) {
      if (!row.id) row.id = `id-${Math.random().toString(36).slice(2, 10)}`;
      const idx = store.findIndex((r) => r.id === row.id);
      if (idx >= 0) store[idx] = { ...store[idx], ...row };
      else store.push(row);
      out.push(row);
    }
    return Array.isArray(entity) ? out : out[0];
  });

  const countFn = jest.fn(async () => store.length);

  const updateFn = jest.fn(async (criteria: any, partial: Partial<T>) => {
    let affected = 0;
    for (const row of store) {
      if (typeof criteria === 'string') {
        if ((row as any).id === criteria) {
          Object.assign(row, partial);
          affected += 1;
        }
      } else if (matches(row, criteria)) {
        Object.assign(row, partial);
        affected += 1;
      }
    }
    return { affected, raw: [], generatedMaps: [] } as any;
  });

  const deleteFn = jest.fn(async (criteria: any) => {
    const before = store.length;
    for (let i = store.length - 1; i >= 0; i -= 1) {
      if (typeof criteria === 'string') {
        if ((store[i] as any).id === criteria) store.splice(i, 1);
      } else if (matches(store[i], criteria)) {
        store.splice(i, 1);
      }
    }
    return { affected: before - store.length, raw: [] } as any;
  });

  const existFn = jest.fn(async (opts: any) => {
    return store.some((r) => matches(r, opts.where));
  });

  const createQueryBuilder = jest.fn(() => {
    const state: {
      ands: Array<(row: T) => boolean>;
      take?: number;
      skip?: number;
      orderBy?: { field: string; dir: 'ASC' | 'DESC' };
    } = { ands: [] };
    const qb: any = {
      where: (sql: string, params?: Record<string, unknown>) => {
        qb.andWhere(sql, params);
        return qb;
      },
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        const param = params ? Object.entries(params)[0] : undefined;
        const m = /^[a-zA-Z]+\.([a-zA-Z]+)\s*(=|IN|ILIKE|<|>|<=|>=)\s*/.exec(
          sql,
        );
        const field = m?.[1];
        const op = m?.[2];
        if (field && op === '=' && param) {
          state.ands.push(
            (row: T) => (row as any)[field] === param[1],
          );
        } else if (field && op === 'IN' && param) {
          const list = (param[1] as unknown[]) ?? [];
          state.ands.push((row: T) => list.includes((row as any)[field]));
        } else if (field && op === 'ILIKE' && param) {
          const pattern = String(param[1]).replace(/%/g, '');
          state.ands.push((row: T) =>
            String((row as any)[field] ?? '')
              .toLowerCase()
              .includes(pattern.toLowerCase()),
          );
        }
        return qb;
      },
      orderBy: (field: string, dir: 'ASC' | 'DESC' = 'ASC') => {
        state.orderBy = {
          field: field.split('.').pop() ?? field,
          dir,
        };
        return qb;
      },
      addOrderBy: (field: string, dir: 'ASC' | 'DESC' = 'ASC') => {
        if (!state.orderBy) state.orderBy = { field: field.split('.').pop() ?? field, dir };
        return qb;
      },
      take: (n: number) => {
        state.take = n;
        return qb;
      },
      skip: (n: number) => {
        state.skip = n;
        return qb;
      },
      select: () => qb,
      addSelect: () => qb,
      groupBy: () => qb,
      setParameters: () => qb,
      setParameter: () => qb,
      leftJoinAndSelect: () => qb,
      leftJoinAndMapOne: () => qb,
      innerJoin: () => qb,
      innerJoinAndSelect: () => qb,
      innerJoinAndMapOne: () => qb,
      getMany: jest.fn(async () => {
        let rows = store.filter((r) => state.ands.every((p) => p(r)));
        if (state.orderBy) {
          const { field, dir } = state.orderBy;
          rows = [...rows].sort((a, b) => {
            const av = (a as any)[field];
            const bv = (b as any)[field];
            if (av === bv) return 0;
            return dir === 'ASC'
              ? av > bv
                ? 1
                : -1
              : av < bv
                ? 1
                : -1;
          });
        }
        if (state.skip) rows = rows.slice(state.skip);
        if (state.take) rows = rows.slice(0, state.take);
        return rows;
      }),
      getManyAndCount: jest.fn(async () => {
        const rows = await qb.getMany();
        return [rows, rows.length];
      }),
      getCount: jest.fn(async () => {
        const rows = store.filter((r) => state.ands.every((p) => p(r)));
        return rows.length;
      }),
      getOne: jest.fn(async () => {
        const rows = await qb.getMany();
        return rows[0] ?? null;
      }),
      getRawAndEntities: jest.fn(async () => {
        const entities = await qb.getMany();
        return { raw: entities, entities };
      }),
      getRawMany: jest.fn(async () => []),
      getRawOne: jest.fn(async () => null),
    };
    return qb;
  });

  return Object.assign(
    {
      find: findFn,
      findOne: findOneFn,
      save: saveFn,
      create: createFn,
      count: countFn,
      update: updateFn,
      delete: deleteFn,
      exist: existFn,
      createQueryBuilder,
    } as any,
    { __store: store },
  );
}

export function createAuditMock() {
  return { record: jest.fn(async () => null) } as any;
}

export const ctx = {
  userId: '00000000-0000-0000-0000-0000000000aa',
  organizationId: '00000000-0000-0000-0000-0000000000bb',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

export const otherCtx = {
  userId: '00000000-0000-0000-0000-0000000000cc',
  organizationId: '00000000-0000-0000-0000-0000000000dd',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};
