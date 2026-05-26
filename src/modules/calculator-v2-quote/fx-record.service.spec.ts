import { FxRecordService } from './fx-record.service';

describe('FxRecordService', () => {
  it('skips recording for same-currency quotes', async () => {
    const svc = new FxRecordService();
    const rec = await svc.record({
      quoteId: 'q1',
      fromCurrency: 'USD',
      toCurrency: 'USD',
      rate: 1,
    });
    expect(rec).toBeNull();
    expect(await svc.recent('q1')).toEqual([]);
  });

  it('records cross-currency snapshots with normalized ISO codes', async () => {
    const svc = new FxRecordService();
    const rec = await svc.record({
      quoteId: 'q2',
      fromCurrency: 'usd',
      toCurrency: 'aud',
      rate: 1.52,
      provider: 'ecb',
    });
    expect(rec).not.toBeNull();
    expect(rec!.fromCurrency).toBe('USD');
    expect(rec!.toCurrency).toBe('AUD');
    expect(rec!.rate).toBe(1.52);
    expect(rec!.provider).toBe('ecb');
    expect(rec!.id).toMatch(/^fx_/);
    expect(rec!.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const recent = await svc.recent('q2');
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe(rec!.id);
  });

  it('returns empty for an unknown quote id', async () => {
    const svc = new FxRecordService();
    await svc.record({
      quoteId: 'q-known',
      fromCurrency: 'USD',
      toCurrency: 'AUD',
      rate: 1.5,
    });
    expect(await svc.recent('q-unknown')).toEqual([]);
  });

  it('uses an injected store when configured', async () => {
    const writes: any[] = [];
    const svc = new FxRecordService();
    svc.configureStore({
      write: (r) => {
        writes.push(r);
      },
      recent: () => writes,
    });
    await svc.record({ quoteId: 'q3', fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 });
    expect(writes).toHaveLength(1);
    expect(writes[0].quoteId).toBe('q3');
  });

  it('defaults provider to "unknown" when not supplied', async () => {
    const svc = new FxRecordService();
    const rec = await svc.record({
      quoteId: 'q4',
      fromCurrency: 'USD',
      toCurrency: 'AUD',
      rate: 1.5,
    });
    expect(rec!.provider).toBe('unknown');
  });

  it('does not throw when the store write fails', async () => {
    const svc = new FxRecordService();
    svc.configureStore({
      write: () => {
        throw new Error('disk full');
      },
      recent: () => [],
    });
    await expect(
      svc.record({ quoteId: 'q5', fromCurrency: 'USD', toCurrency: 'AUD', rate: 1.5 }),
    ).resolves.not.toBeNull();
  });
});
