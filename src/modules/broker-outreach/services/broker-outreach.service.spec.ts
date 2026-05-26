import {
  BrokerOutreachService,
  sanitizeNameCategories,
  validateOsmBbox,
} from './broker-outreach.service';
import type {
  BrokerOutreachCampaignEntity,
  BrokerOutreachInviteEntity,
  BrokerOutreachLeadEntity,
} from '../entities';

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

  async findOne(opts: { where: Record<string, unknown> | Array<Record<string, unknown>> }): Promise<T | null> {
    const wheres = Array.isArray(opts.where) ? opts.where : [opts.where];
    return this.rows.find((row) => wheres.some((where) => matches(row, where))) ?? null;
  }

  async find(opts: { where?: Record<string, unknown>; take?: number } = {}): Promise<T[]> {
    const rows = opts.where
      ? this.rows.filter((row) => matches(row, opts.where ?? {}))
      : [...this.rows];
    return rows.slice(0, opts.take ?? rows.length);
  }
}

describe('BrokerOutreachService', () => {
  function build() {
    const leads = new FakeRepo<BrokerOutreachLeadEntity>('lead');
    const campaigns = new FakeRepo<BrokerOutreachCampaignEntity>('campaign');
    const invites = new FakeRepo<BrokerOutreachInviteEntity>('invite');
    const auth = {
      register: jest.fn(async () => ({
        id: 'user-1',
        organizationId: 'org-1',
      })),
      login: jest.fn(async () => ({
        user: { id: 'user-1' },
        tokens: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 },
      })),
    };
    const apiKeys = {
      generateApiKey: jest.fn(async () => ({
        plainTextKey: 'hts_live_test',
        apiKey: { id: 'api-key-1' },
      })),
    };
    const googleSearch = {
      search: jest.fn(async () => [
        {
          title: 'Pacific Customs Brokers — Seattle',
          url: 'https://pacific-customs.example/contact',
          snippet: 'Customs brokerage for Pacific Northwest importers.',
          displayedHost: 'pacific-customs.example',
        },
      ]),
    };
    const discoveryLedger = {
      beginRun: jest.fn(async () => ({ id: 'run-1' })),
      finishRun: jest.fn(),
      recordResult: jest.fn(),
      listRuns: jest.fn(),
      listResults: jest.fn(),
    };
    const email = {
      send: jest.fn(async () => ({
        status: 'sent',
        provider: 'log-only',
        messageId: 'msg-1',
      })),
      suppress: jest.fn(),
      unsuppress: jest.fn(),
      isSuppressed: jest.fn(() => false),
      listSuppressed: jest.fn(() => []),
    };
    return {
      leads,
      campaigns,
      invites,
      auth,
      apiKeys,
      googleSearch,
      discoveryLedger,
      email,
      service: new BrokerOutreachService(
        leads as any,
        campaigns as any,
        invites as any,
        auth as any,
        apiKeys as any,
        googleSearch as any,
        discoveryLedger as any,
        email as any,
      ),
    };
  }

  it('bulk upserts scraper leads by provider external id', async () => {
    const { service, leads } = build();

    const first = await service.bulkUpsertLeads({
      leads: [
        {
          companyName: 'Acme Customs',
          sourceProvider: 'osm',
          sourceExternalId: 'node/1',
          businessCategory: 'customs_broker',
          websiteUrl: 'https://acme.example',
          contactEmail: 'Ops@Acme.example',
        },
      ],
    });
    const second = await service.bulkUpsertLeads({
      leads: [
        {
          companyName: 'Acme Customs Updated',
          sourceProvider: 'osm',
          sourceExternalId: 'node/1',
          businessCategory: 'customs_broker',
          websiteUrl: 'https://acme.example',
          contactEmail: 'ops@acme.example',
          city: 'Seattle',
        },
      ],
    });

    expect(first.inserted).toBe(1);
    expect(second.updated).toBe(1);
    expect(leads.rows).toHaveLength(1);
    expect(leads.rows[0]).toEqual(
      expect.objectContaining({
        companyName: 'Acme Customs Updated',
        domain: 'acme.example',
        contactEmail: 'ops@acme.example',
        city: 'Seattle',
      }),
    );
  });

  it('creates invite tokens without returning token hashes', async () => {
    const { service } = build();
    const imported = await service.bulkUpsertLeads({
      leads: [
        {
          companyName: 'Northport Broker',
          sourceProvider: 'google',
          sourceExternalId: 'place-1',
          businessCategory: 'customs_broker',
          contactEmail: 'hello@northport.example',
        },
      ],
    });

    const result = await service.createInvite({
      leadId: imported.leads[0].id,
    });

    expect(result.token).toHaveLength(43);
    expect(result.claimUrl).toContain('/broker-outreach/invite?token=');
    expect((result.invite as any).tokenHash).toBeUndefined();
    expect(result.emailDraft.body).toContain(result.claimUrl);
  });

  it('claims an invite into a trial account and marks lead converted', async () => {
    const { service, auth, apiKeys, leads } = build();
    const imported = await service.bulkUpsertLeads({
      leads: [
        {
          companyName: 'Northport Broker',
          sourceProvider: 'google',
          sourceExternalId: 'place-1',
          businessCategory: 'customs_broker',
          websiteUrl: 'https://northport.example',
          contactEmail: 'hello@northport.example',
          country: 'US',
        },
      ],
    });
    const invite = await service.createInvite({ leadId: imported.leads[0].id });

    const result = await service.claimInvite(invite.token, {
      email: 'hello@northport.example',
      password: 'strong-password',
      firstName: 'Alex',
      lastName: 'Morgan',
    });

    expect(auth.register).toHaveBeenCalledWith(
      'hello@northport.example',
      'strong-password',
      'Alex',
      'Morgan',
      null,
      expect.objectContaining({
        name: 'Northport Broker',
        websiteUrl: 'https://northport.example',
        integrationType: 'broker-outreach',
      }),
    );
    expect(apiKeys.generateApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        permissions: expect.arrayContaining(['broker:marketplace']),
      }),
    );
    expect(result.apiKey).toBe('hts_live_test');
    expect(leads.rows[0].status).toBe('converted');
  });

  it('resumes a previously-partially-claimed invite without re-creating the user', async () => {
    const { service, auth, invites, leads } = build();
    const imported = await service.bulkUpsertLeads({
      leads: [
        {
          companyName: 'Resume Broker',
          sourceProvider: 'manual',
          contactEmail: 'resume@example.com',
        },
      ],
    });
    const created = await service.createInvite({
      leadId: imported.leads[0].id,
    });

    // Simulate a prior crash: the invite already records claimed user
    // and organization but never moved to `claimed` status.
    const invite = invites.rows[0];
    invite.claimedUserId = 'user-1';
    invite.claimedOrganizationId = 'org-1';
    invite.status = 'opened';
    invite.openedAt = new Date();

    await service.claimInvite(created.token, {
      email: 'resume@example.com',
      password: 'strong-password',
      firstName: 'A',
      lastName: 'B',
    });

    // Recovery path must not re-register the user.
    expect(auth.register).not.toHaveBeenCalled();
    expect(invites.rows[0].status).toBe('claimed');
    expect(leads.rows[0].status).toBe('converted');
  });

  it('does not call Google Places API and uses the scraper service', async () => {
    const { service, googleSearch, leads } = build();
    const result = await service.discoverFromGoogleSearch({
      textQuery: 'customs broker seattle',
      pageSize: 5,
    });
    expect(googleSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'customs broker seattle', limit: 5 }),
    );
    expect(result.provider).toBe('google-search');
    expect(result.inserted).toBe(1);
    expect(leads.rows[0].sourceProvider).toBe('google');
    expect(leads.rows[0].metadata).toEqual(
      expect.objectContaining({
        googleSearch: expect.objectContaining({
          url: 'https://pacific-customs.example/contact',
        }),
      }),
    );
  });

  it('requires GoogleSearchScraperService to be wired before discovering via Google', async () => {
    const { service } = (function buildWithoutScraper() {
      const leads = new FakeRepo<BrokerOutreachLeadEntity>('lead');
      const campaigns = new FakeRepo<BrokerOutreachCampaignEntity>('campaign');
      const invites = new FakeRepo<BrokerOutreachInviteEntity>('invite');
      const auth = { register: jest.fn(), login: jest.fn() };
      const apiKeys = { generateApiKey: jest.fn() };
      return {
        service: new BrokerOutreachService(
          leads as any,
          campaigns as any,
          invites as any,
          auth as any,
          apiKeys as any,
          null,
        ),
      };
    })();
    await expect(
      service.discoverFromGoogleSearch({ textQuery: 'broker' }),
    ).rejects.toThrow(/scraper not configured/i);
  });

  it('preserves primary source provenance and appends a sourceHistory entry on conflicting upsert', async () => {
    const { service, leads } = build();
    await service.bulkUpsertLeads({
      leads: [
        {
          companyName: 'Acme Customs',
          sourceProvider: 'osm',
          sourceExternalId: 'node/1',
          contactEmail: 'ops@acme.example',
        },
      ],
    });
    // Now the same lead surfaces from Google Search — domain match.
    await service.bulkUpsertLeads({
      leads: [
        {
          companyName: 'Acme Customs Updated',
          sourceProvider: 'google',
          sourceExternalId: 'https://acme.example/contact',
          contactEmail: 'ops@acme.example',
        },
      ],
    });
    expect(leads.rows).toHaveLength(1);
    expect(leads.rows[0].sourceProvider).toBe('osm');
    expect(leads.rows[0].sourceExternalId).toBe('node/1');
    expect((leads.rows[0].metadata as any).sourceHistory).toEqual([
      expect.objectContaining({
        provider: 'google',
        externalId: 'https://acme.example/contact',
      }),
    ]);
  });

  it('records a discovery ledger run when discovering via Google Search', async () => {
    const { service, discoveryLedger } = build();
    const result = await service.discoverFromGoogleSearch({
      textQuery: 'customs broker seattle',
    });
    expect(discoveryLedger.beginRun).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google-search' }),
    );
    expect(discoveryLedger.recordResult).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'ingested' }),
    );
    expect(discoveryLedger.finishRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ fetched: 1, inserted: 1 }),
    );
    expect(result.runId).toBe('run-1');
  });

  it('routes the invite email through the email service and stores the result on the invite', async () => {
    const { service, email, invites } = build();
    const imported = await service.bulkUpsertLeads({
      leads: [
        {
          companyName: 'Email Test Co',
          sourceProvider: 'manual',
          contactEmail: 'hello@etc.example',
        },
      ],
    });
    const created = await service.createInvite({
      leadId: imported.leads[0].id,
    });
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'hello@etc.example',
        leadId: imported.leads[0].id,
      }),
    );
    expect(created.send?.status).toBe('sent');
    expect(invites.rows[0].status).toBe('sent');
    expect(invites.rows[0].sentAt).toBeInstanceOf(Date);
  });

  it('preview does NOT mutate invite state; explicit recordInviteOpened flips status', async () => {
    const { service, invites } = build();
    const imported = await service.bulkUpsertLeads({
      leads: [
        {
          companyName: 'Mutation Test Co',
          sourceProvider: 'manual',
          contactEmail: 'human@etc.example',
        },
      ],
    });
    const created = await service.createInvite({ leadId: imported.leads[0].id });
    const before = invites.rows[0].status;
    // Preview should not flip status (would be flipped to 'sent' by the email service first).
    const preview = await service.previewInvite(created.token);
    expect((preview.invite as any).status).toBe(before);
    expect(invites.rows[0].openedAt ?? null).toBeNull();
    // Explicit beacon call records the open.
    const openResult = await service.recordInviteOpened(created.token);
    expect(openResult.opened).toBe(true);
    expect(invites.rows[0].status).toBe('opened');
    expect(invites.rows[0].openedAt).toBeInstanceOf(Date);
    // Second call is a no-op (already opened).
    const second = await service.recordInviteOpened(created.token);
    expect(second.opened).toBe(false);
  });

  it('does NOT reference GOOGLE_PLACES_API_KEY anywhere in the implementation', () => {
    // Guards against accidental reintroduction of the Google Places API path.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, 'broker-outreach.service.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/GOOGLE_PLACES_API_KEY/);
    expect(src).not.toMatch(/places\.googleapis\.com/);
  });
});

describe('validateOsmBbox', () => {
  it('accepts a small bbox in correct orientation', () => {
    expect(validateOsmBbox([47, -122.5, 47.5, -122])).toEqual([
      47, -122.5, 47.5, -122,
    ]);
  });
  it('rejects swapped south/north', () => {
    expect(() => validateOsmBbox([47.5, -122.5, 47, -122])).toThrow(/south/);
  });
  it('rejects swapped west/east', () => {
    expect(() => validateOsmBbox([47, -122, 47.5, -122.5])).toThrow(/west/);
  });
  it('rejects out-of-range latitudes', () => {
    expect(() => validateOsmBbox([-91, -122, 47, -120])).toThrow(/lat/);
  });
  it('rejects out-of-range longitudes', () => {
    expect(() => validateOsmBbox([47, -181, 47.5, -120])).toThrow(/lon/);
  });
  it('rejects an oversize bbox', () => {
    expect(() => validateOsmBbox([0, 0, 60, 60])).toThrow(/exceeds cap/);
  });
});

describe('sanitizeNameCategories', () => {
  it('falls back to the full allowlist when none supplied', () => {
    expect(sanitizeNameCategories(undefined).length).toBeGreaterThan(0);
  });
  it('keeps only allowlisted categories', () => {
    expect(sanitizeNameCategories(['customs', 'evil; DROP TABLE'])).toEqual([
      'customs',
    ]);
  });
});

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    return row[key] === value;
  });
}
