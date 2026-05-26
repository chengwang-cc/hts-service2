import { FxRateProviderService } from './fx-rate-provider.service';

const originalFetch = global.fetch;

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  json?: any;
  throws?: boolean;
}): jest.Mock {
  const m = jest.fn().mockImplementation(async () => {
    if (response.throws) throw new Error('network down');
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json ?? {},
    } as any;
  });
  (global as any).fetch = m;
  return m;
}

afterEach(() => {
  (global as any).fetch = originalFetch;
});

describe('FxRateProviderService', () => {
  it('returns identity rate for same-currency lookups', async () => {
    const svc = new FxRateProviderService();
    const lookup = await svc.fetchRate('USD', 'usd');
    expect(lookup).not.toBeNull();
    expect(lookup!.rate).toBe(1);
    expect(lookup!.provider).toBe('identity');
  });

  it('fetches from frankfurter.app and normalizes the response', async () => {
    const m = mockFetch({
      json: { amount: 1, base: 'USD', date: '2026-05-25', rates: { AUD: 1.52 } },
    });
    const svc = new FxRateProviderService();
    svc.clearCache();
    const lookup = await svc.fetchRate('USD', 'AUD');
    expect(lookup).toEqual({
      rate: 1.52,
      observedAt: '2026-05-25',
      provider: 'frankfurter',
    });
    expect(m).toHaveBeenCalledTimes(1);
    expect(m.mock.calls[0][0]).toMatch(/frankfurter\.app/);
    expect(m.mock.calls[0][0]).toMatch(/from=USD/);
    expect(m.mock.calls[0][0]).toMatch(/to=AUD/);
  });

  it('caches a successful lookup so a second call does not hit the network', async () => {
    const m = mockFetch({
      json: { date: '2026-05-25', rates: { AUD: 1.5 } },
    });
    const svc = new FxRateProviderService();
    svc.clearCache();
    await svc.fetchRate('USD', 'AUD');
    await svc.fetchRate('USD', 'AUD');
    expect(m).toHaveBeenCalledTimes(1);
  });

  it('returns null for non-OK HTTP responses', async () => {
    mockFetch({ ok: false, status: 503, json: {} });
    const svc = new FxRateProviderService();
    svc.clearCache();
    const lookup = await svc.fetchRate('USD', 'AUD');
    expect(lookup).toBeNull();
  });

  it('returns null when the upstream payload is malformed', async () => {
    mockFetch({ json: { rates: { ZZZ: 'not-a-number' } } });
    const svc = new FxRateProviderService();
    svc.clearCache();
    const lookup = await svc.fetchRate('USD', 'AUD');
    expect(lookup).toBeNull();
  });

  it('returns null when fetch throws (timeout / network)', async () => {
    mockFetch({ throws: true });
    const svc = new FxRateProviderService();
    svc.clearCache();
    const lookup = await svc.fetchRate('USD', 'AUD');
    expect(lookup).toBeNull();
  });

  it('uses the configured upstream URL', async () => {
    const m = mockFetch({ json: { date: '2026-05-25', rates: { EUR: 0.92 } } });
    const svc = new FxRateProviderService();
    svc.clearCache();
    svc.configureUpstream('https://example.test/');
    await svc.fetchRate('USD', 'EUR');
    expect(m.mock.calls[0][0]).toMatch(/^https:\/\/example\.test\/latest/);
  });

  it('returns null for empty currencies', async () => {
    const svc = new FxRateProviderService();
    expect(await svc.fetchRate('', 'AUD')).toBeNull();
    expect(await svc.fetchRate('USD', '')).toBeNull();
  });
});
