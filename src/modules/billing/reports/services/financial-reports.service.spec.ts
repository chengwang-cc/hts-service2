import { FinancialReportsService } from './financial-reports.service';

/**
 * FinancialReportsService unit tests.
 *
 * The materialized views are SQL, so we mock the DataSource.query
 * implementation per test. Each test pins one row shape so the test
 * stays narrow and brittle-to-the-right-things (we WANT a future
 * schema change to break these so we re-validate the view shape).
 */

const buildService = (queryImpl: (sql: string, params?: any[]) => Promise<any>) => {
  const ds = {
    query: jest.fn(async (sql: string, params?: any[]) => queryImpl(sql, params)),
  };
  const svc = new FinancialReportsService(ds as any);
  return { svc, ds };
};

describe('FinancialReportsService.refreshAll', () => {
  it('refreshes all three views CONCURRENTLY when they\'re already populated', async () => {
    const { svc, ds } = buildService(async () => undefined);
    const result = await svc.refreshAll();
    expect(result.refreshed).toEqual([
      'mv_revenue_monthly',
      'mv_refunds_monthly',
      'mv_top_accounts_t12m',
    ]);
    expect(result.failed).toEqual([]);
    expect(ds.query).toHaveBeenCalledTimes(3);
    expect((ds.query.mock.calls[0][0] as string)).toMatch(
      /REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_revenue_monthly"/,
    );
  });

  it('falls back to non-concurrent on first run (when view has never been populated)', async () => {
    let firstAttempt = true;
    const { svc, ds } = buildService(async (sql) => {
      if (sql.includes('CONCURRENTLY') && firstAttempt) {
        firstAttempt = false;
        throw new Error('cannot be refreshed concurrently');
      }
      return undefined;
    });
    const result = await svc.refreshAll();
    expect(result.refreshed).toContain('mv_revenue_monthly');
    expect(result.failed).toEqual([]);
    // The fallback path should have issued a plain REFRESH.
    expect(
      ds.query.mock.calls.some(([sql]) =>
        /^[\s\S]*REFRESH MATERIALIZED VIEW "mv_revenue_monthly"[\s\S]*$/.test(sql),
      ),
    ).toBe(true);
  });

  it('logs failures per-view and continues', async () => {
    const { svc } = buildService(async (sql) => {
      if (sql.includes('mv_refunds_monthly')) {
        throw new Error('disk full');
      }
      return undefined;
    });
    const result = await svc.refreshAll();
    expect(result.refreshed).toContain('mv_revenue_monthly');
    expect(result.refreshed).toContain('mv_top_accounts_t12m');
    expect(result.failed).toEqual([
      { view: 'mv_refunds_monthly', error: 'disk full' },
    ]);
  });
});

describe('FinancialReportsService.revenueByMonth', () => {
  it('returns rows mapped to the dashboard shape', async () => {
    const { svc } = buildService(async () => [
      {
        month: new Date('2026-05-01T00:00:00Z'),
        source: 'credit_purchase',
        count: 12,
        gross_usd: '420.00',
        gross_usd_cents: '42000',
      },
      {
        month: new Date('2026-05-01T00:00:00Z'),
        source: 'invoice',
        count: 5,
        gross_usd: '500.00',
        gross_usd_cents: '50000',
      },
    ]);
    const out = await svc.revenueByMonth({});
    expect(out).toEqual([
      {
        month: '2026-05-01',
        source: 'credit_purchase',
        count: 12,
        grossUsd: 420,
        grossUsdCents: 42000,
      },
      {
        month: '2026-05-01',
        source: 'invoice',
        count: 5,
        grossUsd: 500,
        grossUsdCents: 50000,
      },
    ]);
  });

  it('parameterizes from/to month bounds', async () => {
    let captured: { sql: string; params?: any[] } = { sql: '', params: undefined };
    const { svc } = buildService(async (sql, params) => {
      captured = { sql, params };
      return [];
    });
    await svc.revenueByMonth({ fromMonth: '2026-01', toMonth: '2026-06' });
    expect(captured.params).toEqual(['2026-01-01', '2026-06-01']);
    expect(captured.sql).toMatch(/month >= \$1::date/);
    expect(captured.sql).toMatch(/month <= \$2::date/);
  });

  it('defaults to trailing 24 months when no range is provided', async () => {
    let captured = '';
    const { svc } = buildService(async (sql) => {
      captured = sql;
      return [];
    });
    await svc.revenueByMonth({});
    expect(captured).toMatch(/interval '24 months'/);
  });
});

describe('FinancialReportsService.refundsByMonth', () => {
  it('returns mapped rows with refundRate as a 0-1 float', async () => {
    const { svc } = buildService(async () => [
      {
        month: new Date('2026-05-01T00:00:00Z'),
        refund_count: 3,
        refunded_cents: '4500',
        credits_returned: 100,
        gross_cents: '150000',
        refund_rate: '0.030000',
      },
    ]);
    const out = await svc.refundsByMonth({});
    expect(out).toEqual([
      {
        month: '2026-05-01',
        refundCount: 3,
        refundedCents: 4500,
        creditsReturned: 100,
        grossCents: 150000,
        refundRate: 0.03,
      },
    ]);
  });
});

describe('FinancialReportsService.manualCredits', () => {
  it('returns rows grouped by reason_code by default', async () => {
    let captured = '';
    const { svc } = buildService(async (sql) => {
      captured = sql;
      return [
        {
          key: 'GOODWILL',
          topup_count: 5,
          topup_credits: 250,
          debit_count: 1,
          debit_credits: 10,
        },
      ];
    });
    const out = await svc.manualCredits({});
    expect(captured).toMatch(/COALESCE\(reason_code, 'UNCATEGORIZED'\)/);
    expect(out).toEqual({
      groupBy: 'reason_code',
      rows: [
        {
          key: 'GOODWILL',
          grants: { count: 5, credits: 250 },
          debits: { count: 1, credits: 10 },
        },
      ],
    });
  });

  it('switches the group expression when groupBy=month', async () => {
    let captured = '';
    const { svc } = buildService(async (sql) => {
      captured = sql;
      return [];
    });
    await svc.manualCredits({ groupBy: 'month' });
    expect(captured).toMatch(/date_trunc\('month'/);
  });
});

describe('FinancialReportsService.topAccounts', () => {
  it('caps limit at 200 and maps the row shape', async () => {
    let captured: any[] | undefined;
    const { svc } = buildService(async (_sql, params) => {
      captured = params;
      return [
        {
          organization_id: 'org-1',
          organization_name: 'ChitChats',
          organization_slug: 'chitchats',
          revenue_usd: '12345.67',
          revenue_cents: '1234567',
        },
      ];
    });
    const out = await svc.topAccounts(5000);
    expect(captured).toEqual([200]); // clamped
    expect(out).toEqual([
      {
        organizationId: 'org-1',
        organizationName: 'ChitChats',
        organizationSlug: 'chitchats',
        revenueUsd: 12345.67,
        revenueCents: 1234567,
      },
    ]);
  });
});

describe('FinancialReportsService.dashboardSummary', () => {
  it('computes MoM change pct as null when prior month was zero', async () => {
    const queryStack: any[] = [
      [{ usd: '1200.00' }], // current month
      [{ usd: '0.00' }], // prior month
      [{ refunded: '0', gross: '0' }], // refund summary
      [{ n: '5' }], // active orgs
      [{ ts: new Date('2026-05-01T00:00:00Z') }], // last refreshed
    ];
    const { svc } = buildService(async () => queryStack.shift());
    const out = await svc.dashboardSummary();
    expect(out.currentMrrUsd).toBe(1200);
    expect(out.mrrMomChangePct).toBeNull();
    expect(out.refundRateT12m).toBe(0);
    expect(out.activeOrgs30d).toBe(5);
    expect(out.lastRefreshedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('computes signed MoM change pct against a non-zero prior month', async () => {
    const queryStack: any[] = [
      [{ usd: '1200.00' }],
      [{ usd: '1000.00' }],
      [{ refunded: '5000', gross: '500000' }],
      [{ n: '12' }],
      [{ ts: null }],
    ];
    const { svc } = buildService(async () => queryStack.shift());
    const out = await svc.dashboardSummary();
    expect(out.mrrMomChangePct).toBeCloseTo(20.0); // (1200-1000)/1000 * 100
    expect(out.refundRateT12m).toBeCloseTo(0.01);
    expect(out.activeOrgs30d).toBe(12);
    expect(out.lastRefreshedAt).toBeNull();
  });
});

describe('FinancialReportsService.paidVsPromoCredits (F9.1.5)', () => {
  it('computes paid/promo split + paidPct per month', async () => {
    const { svc } = buildService(async () => [
      {
        month: new Date('2026-05-01T00:00:00Z'),
        paid: '300',
        promo: '100',
      },
      {
        month: new Date('2026-06-01T00:00:00Z'),
        paid: '0',
        promo: '50',
      },
    ]);
    const out = await svc.paidVsPromoCredits({});
    expect(out).toEqual([
      { month: '2026-05-01', paidCredits: 300, promoCredits: 100, paidPct: 0.75 },
      { month: '2026-06-01', paidCredits: 0, promoCredits: 50, paidPct: 0 },
    ]);
  });

  it('SQL filters to delta_credits > 0 and the right kinds', async () => {
    let captured = '';
    const { svc } = buildService(async (sql) => {
      captured = sql;
      return [];
    });
    await svc.paidVsPromoCredits({ fromMonth: '2026-01', toMonth: '2026-06' });
    expect(captured).toMatch(/delta_credits > 0/);
    expect(captured).toMatch(/PURCHASE.*AUTO_TOPUP/);
    expect(captured).toMatch(/MANUAL_TOPUP.*PROMO.*MIGRATION/);
  });
});

describe('FinancialReportsService.autoTopupVelocity (F9.1.5)', () => {
  it('maps rows + caps limit at 200', async () => {
    let captured: any[] | undefined;
    const { svc } = buildService(async (_sql, params) => {
      captured = params;
      return [
        {
          organization_id: 'org-1',
          topup_count: '4',
          first_at: new Date('2026-01-01T00:00:00Z'),
          last_at: new Date('2026-04-01T00:00:00Z'),
          avg_interval_days: '30.00',
        },
      ];
    });
    const out = await svc.autoTopupVelocity(500);
    expect(captured).toEqual([200]); // clamped
    expect(out[0]).toEqual({
      organizationId: 'org-1',
      topupCount: 4,
      firstTopupAt: '2026-01-01T00:00:00.000Z',
      lastTopupAt: '2026-04-01T00:00:00.000Z',
      avgIntervalDays: 30,
    });
  });

  it('SQL excludes orgs with only one topup (HAVING COUNT >= 2)', async () => {
    let captured = '';
    const { svc } = buildService(async (sql) => {
      captured = sql;
      return [];
    });
    await svc.autoTopupVelocity();
    expect(captured).toMatch(/HAVING COUNT\(\*\) >= 2/);
  });
});

describe('FinancialReportsService.unbilledUsage (F9.1.5)', () => {
  it('maps rows including nullable lastInvoiceAt', async () => {
    const { svc } = buildService(async () => [
      {
        organization_id: 'org-1',
        unbilled_records: '125',
        last_invoice_at: new Date('2026-05-01T00:00:00Z'),
        oldest_unbilled_at: new Date('2026-05-02T00:00:00Z'),
      },
      {
        organization_id: 'org-2',
        unbilled_records: '10',
        last_invoice_at: null,
        oldest_unbilled_at: new Date('2026-04-01T00:00:00Z'),
      },
    ]);
    const out = await svc.unbilledUsage();
    expect(out).toEqual([
      {
        organizationId: 'org-1',
        unbilledRecords: 125,
        lastInvoiceAt: '2026-05-01T00:00:00.000Z',
        oldestUnbilledAt: '2026-05-02T00:00:00.000Z',
      },
      {
        organizationId: 'org-2',
        unbilledRecords: 10,
        lastInvoiceAt: null,
        oldestUnbilledAt: '2026-04-01T00:00:00.000Z',
      },
    ]);
  });
});

describe('FinancialReportsService.toCsv', () => {
  it('emits headers + rows joined by newlines', () => {
    const { svc } = buildService(async () => []);
    const csv = svc.toCsv(['a', 'b'], [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
    expect(csv).toBe('a,b\n1,2\n3,4');
  });

  it('quotes fields containing commas / quotes / newlines and doubles internal quotes', () => {
    const { svc } = buildService(async () => []);
    const csv = svc.toCsv(['name', 'note'], [
      { name: 'ACME, Inc.', note: 'said "hi"' },
      { name: 'next\nline', note: null },
    ]);
    // Newlines inside a quoted cell are preserved (per RFC 4180);
    // splitting on '\n' is intentionally NOT used here.
    expect(csv).toBe(
      'name,note\n"ACME, Inc.","said ""hi"""\n"next\nline",',
    );
  });

  it('emits empty strings for null/undefined cells', () => {
    const { svc } = buildService(async () => []);
    const csv = svc.toCsv(['a', 'b'], [{ a: null, b: undefined }]);
    expect(csv).toBe('a,b\n,');
  });
});
