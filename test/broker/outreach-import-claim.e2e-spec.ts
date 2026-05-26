import {
  BrokerOutreachCampaignEngineService,
} from '../../src/modules/broker-outreach/services/broker-outreach-campaign-engine.service';
import {
  BrokerOutreachDiscoveryLedgerService,
} from '../../src/modules/broker-outreach/services/broker-outreach-discovery-ledger.service';
import {
  BrokerOutreachEmailService,
  LogOnlyOutreachEmailProvider,
} from '../../src/modules/broker-outreach/services/broker-outreach-email.service';
import {
  BrokerOutreachRetentionService,
} from '../../src/modules/broker-outreach/services/broker-outreach-retention.service';
import { BrokerOutreachService } from '../../src/modules/broker-outreach/services/broker-outreach.service';
import type {
  BrokerOutreachCampaignEntity,
  BrokerOutreachDiscoveryResultEntity,
  BrokerOutreachDiscoveryRunEntity,
  BrokerOutreachInviteEntity,
  BrokerOutreachLeadEntity,
} from '../../src/modules/broker-outreach/entities';

/**
 * End-to-end orchestration of the outreach flow:
 *   1. bulk import → leads + ledger run
 *   2. createInvite → ledger ledger entry, email queue, invite row
 *   3. previewInvite (GET) is pure — no state mutation
 *   4. recordInviteOpened flips status='opened'
 *   5. claimInvite registers user, issues key, marks invite claimed,
 *      flips lead to converted
 *   6. retention.sweep marks expired invites + purges old runs
 */

class FakeRepo<T extends { id?: string; createdAt?: Date; updatedAt?: Date }> {
  rows: T[] = [];
  private seq = 0;

  constructor(private readonly prefix: string) {}

  create(partial: Partial<T>): T {
    return { ...(partial as T) };
  }

  async save(row: T): Promise<T> {
    if (!row.id) {
      row.id = `${this.prefix}-${++this.seq}`;
      row.createdAt = new Date();
      row.updatedAt = new Date();
      this.rows.push(row);
      return row;
    }
    const i = this.rows.findIndex((r) => r.id === row.id);
    row.updatedAt = new Date();
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
    return row;
  }

  async findOne(opts: {
    where: Record<string, unknown> | Array<Record<string, unknown>>;
  }): Promise<T | null> {
    const wheres = Array.isArray(opts.where) ? opts.where : [opts.where];
    return (
      this.rows.find((r) => wheres.some((w) => matches(r, w))) ?? null
    );
  }

  async find(opts: {
    where?: Record<string, unknown>;
    take?: number;
  } = {}): Promise<T[]> {
    const rows = opts.where
      ? this.rows.filter((r) => matches(r, opts.where ?? {}))
      : [...this.rows];
    return rows.slice(0, opts.take ?? rows.length);
  }

  async delete(criteria: any): Promise<{ affected: number }> {
    const ids = Array.isArray(criteria) ? criteria : [criteria];
    let removed = 0;
    for (const id of ids) {
      const i = this.rows.findIndex((r) => r.id === id);
      if (i >= 0) {
        this.rows.splice(i, 1);
        removed += 1;
      }
    }
    return { affected: removed };
  }

  /**
   * Tiny query-builder stand-in. Supports the chain used by the
   * retention service: `.update().set(...).where(...).andWhere(...).execute()`
   * and `.delete().where(...).execute()`.
   */
  createQueryBuilder(): any {
    let mode: 'update' | 'delete' | 'select' = 'select';
    let setValues: Record<string, unknown> | null = null;
    const wheres: Array<(row: T) => boolean> = [];

    const builder: any = {
      update: () => {
        mode = 'update';
        return builder;
      },
      delete: () => {
        mode = 'delete';
        return builder;
      },
      set: (values: Record<string, unknown>) => {
        setValues = values;
        return builder;
      },
      where: (clause: string, params: Record<string, unknown> = {}) => {
        wheres.push(makeMatcher(clause, params));
        return builder;
      },
      andWhere: (clause: string, params: Record<string, unknown> = {}) => {
        wheres.push(makeMatcher(clause, params));
        return builder;
      },
      execute: async () => {
        const targets = this.rows.filter((r) => wheres.every((p) => p(r)));
        if (mode === 'update' && setValues) {
          for (const row of targets) Object.assign(row, setValues);
        }
        if (mode === 'delete') {
          for (const row of targets) {
            const i = this.rows.findIndex((r) => r.id === row.id);
            if (i >= 0) this.rows.splice(i, 1);
          }
        }
        return { affected: targets.length };
      },
    };
    return builder;
  }
}

/**
 * Translate the small subset of TypeORM where-clauses the retention
 * service actually uses into in-memory predicates.
 *
 *   "expiresAt < :now" → row.expiresAt < params.now
 *   "status IN (:...openStatuses)" → openStatuses.includes(row.status)
 *   "runId IN (:...ids)" → ids.includes(row.runId)
 */
function makeMatcher<T extends Record<string, any>>(
  clause: string,
  params: Record<string, unknown>,
): (row: T) => boolean {
  const lt = clause.match(/^(\w+)\s*<\s*:(\w+)/);
  if (lt) {
    const field = lt[1];
    const value = params[lt[2]] as Date;
    return (row) => {
      const v = row[field];
      return v instanceof Date && v.getTime() < value.getTime();
    };
  }
  const inMatch = clause.match(/^(\w+)\s+IN\s*\(:\.\.\.(\w+)\)/i);
  if (inMatch) {
    const field = inMatch[1];
    const list = params[inMatch[2]] as unknown[];
    return (row) => list.includes(row[field]);
  }
  // Default: always true. Real codepaths add only what we model above.
  return () => true;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) =>
    v === undefined ? true : (row as any)[k] === v,
  );
}

describe('Outreach end-to-end: import → invite → claim → retention', () => {
  function build() {
    const leads = new FakeRepo<BrokerOutreachLeadEntity>('lead');
    const campaigns = new FakeRepo<BrokerOutreachCampaignEntity>('campaign');
    const invites = new FakeRepo<BrokerOutreachInviteEntity>('invite');
    const runs = new FakeRepo<BrokerOutreachDiscoveryRunEntity>('run');
    const results = new FakeRepo<BrokerOutreachDiscoveryResultEntity>('result');

    const auth = {
      register: jest.fn(async () => ({ id: 'user-1', organizationId: 'org-1' })),
      login: jest.fn(async () => ({
        user: { id: 'user-1' },
        tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 3600 },
      })),
    };
    const apiKeys = {
      generateApiKey: jest.fn(async () => ({
        plainTextKey: 'hts_live_test',
        apiKey: { id: 'key-1' },
      })),
    };

    const ledger = new BrokerOutreachDiscoveryLedgerService(
      runs as any,
      results as any,
    );
    const emailProvider = new LogOnlyOutreachEmailProvider();
    const email = new BrokerOutreachEmailService(emailProvider);
    const audit = { record: jest.fn(async () => null) };
    const service = new BrokerOutreachService(
      leads as any,
      campaigns as any,
      invites as any,
      auth as any,
      apiKeys as any,
      null,
      ledger,
      email,
      audit as any,
    );
    const retention = new BrokerOutreachRetentionService(
      invites as any,
      runs as any,
      results as any,
      audit as any,
    );
    return {
      leads,
      campaigns,
      invites,
      runs,
      results,
      auth,
      apiKeys,
      email,
      audit,
      service,
      retention,
    };
  }

  it('runs the full outreach lifecycle without state leaks', async () => {
    const { service, leads, invites, audit, retention, runs } = build();

    // 1. Bulk import.
    const imported = await service.bulkUpsertLeads({
      leads: [
        {
          companyName: 'E2E Broker',
          sourceProvider: 'manual',
          contactEmail: 'e2e@example.com',
          country: 'US',
        },
      ],
    });
    expect(imported.inserted).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'broker_outreach.leads_imported' }),
    );

    // 2. Create invite. Email transport is wired, so status → 'sent'.
    const created = await service.createInvite({ leadId: imported.leads[0].id });
    expect(invites.rows[0].status).toBe('sent');
    expect(created.send?.status).toBe('sent');

    // 3. Preview should NOT mutate state.
    const beforePreview = { ...invites.rows[0] };
    await service.previewInvite(created.token);
    expect(invites.rows[0].status).toBe(beforePreview.status);
    expect(invites.rows[0].openedAt).toBe(beforePreview.openedAt);

    // 4. recordInviteOpened flips state.
    const opened = await service.recordInviteOpened(created.token);
    expect(opened.opened).toBe(true);
    expect(invites.rows[0].status).toBe('opened');

    // 5. Claim. Email matches, account is created.
    const claim = await service.claimInvite(created.token, {
      email: 'e2e@example.com',
      password: 'strong-password',
      firstName: 'A',
      lastName: 'B',
    });
    expect(claim.apiKey).toBe('hts_live_test');
    expect(leads.rows[0].status).toBe('converted');
    expect(invites.rows[0].status).toBe('claimed');

    // 6. Retention sweep with an already-expired invite should mark it
    //    expired but leave the claimed one alone.
    const stale = (await service.createInvite({
      leadId: imported.leads[0].id,
    })).invite;
    const staleInvite = invites.rows.find((r) => r.id === stale.id)!;
    staleInvite.expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Reset to unclaimed open status so it's eligible for expiry.
    staleInvite.status = 'sent';

    const sweep = await retention.sweep();
    expect(sweep.expiredInvites).toBe(1);
    expect(
      invites.rows.find((r) => r.id === staleInvite.id)?.status,
    ).toBe('expired');
    // The claimed invite is untouched.
    expect(invites.rows.find((r) => r.status === 'claimed')).toBeTruthy();

    // 7. Ledger sweep doesn't reach any runs in this scenario (no runs
    //    were created — bulkUpsertLeads bypasses the discovery flow).
    expect(sweep.deletedRuns).toBe(0);
    expect(runs.rows.length).toBe(0);
  });
});
