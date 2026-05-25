import { GenericCsvAdapter } from '../../src/modules/broker-adapters/adapters/generic-csv.adapter';
import { JsonWebhookAdapter } from '../../src/modules/broker-adapters/adapters/json-webhook.adapter';
import { ProviderProfileAdapter } from '../../src/modules/broker-adapters/adapters/provider-profile.adapter';
import type { AdapterContext } from '../../src/modules/broker-adapters/adapters/adapter.contract';
import type { BrokerEntryEntity } from '../../src/modules/broker-entries/entities/broker-entry.entity';
import type { BrokerEntryLineEntity } from '../../src/modules/broker-entries/entities/broker-entry-line.entity';
import type { BrokerAdapterEntity } from '../../src/modules/broker-adapters/entities/broker-adapter.entity';

const baseEntry: Partial<BrokerEntryEntity> = {
  id: 'e1',
  entryNumber: 'E0001',
  entryType: 'consumption',
  currency: 'USD',
  totalValue: '1234.50',
};

const baseLines: Partial<BrokerEntryLineEntity>[] = [
  {
    id: 'l1',
    lineNumber: 1,
    sku: 'A',
    description: 'Cotton tee',
    htsNumber: '6109.10.00',
    countryOfOrigin: 'VN',
    quantity: '10',
    unitOfMeasure: 'EA',
    unitValue: '100',
    totalValue: '1000',
    currency: 'USD',
  },
  {
    id: 'l2',
    lineNumber: 2,
    sku: 'B',
    description: 'Note,with,comma',
    htsNumber: '6109.10.00',
    countryOfOrigin: 'CN',
    quantity: '5',
    unitOfMeasure: 'EA',
    unitValue: '46.9',
    totalValue: '234.50',
    currency: 'USD',
  },
];

function ctx(
  adapter: Partial<BrokerAdapterEntity> = {},
): AdapterContext {
  return {
    adapter: {
      id: 'a1',
      organizationId: 'org1',
      adapterType: 'generic_csv',
      label: 'CSV',
      status: 'active',
      fieldMappingProfile: null,
      publicConfig: null,
      encryptedConfig: null,
      ...adapter,
    } as BrokerAdapterEntity,
    entry: baseEntry as BrokerEntryEntity,
    lines: baseLines as unknown as BrokerEntryLineEntity[],
  };
}

describe('GenericCsvAdapter', () => {
  const adapter = new GenericCsvAdapter();
  it('emits header + row per line, escaping commas', async () => {
    const artifact = await adapter.build(ctx());
    const text = artifact.body.toString('utf-8');
    const lines = text.split('\n');
    expect(lines[0]).toContain('entryNumber');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('"Note,with,comma"');
  });

  it('declares required fields including HTS and totalValue', () => {
    const fields = adapter.requiredFields();
    expect(fields).toContain('line.htsNumber');
    expect(fields).toContain('line.totalValue');
  });
});

describe('JsonWebhookAdapter', () => {
  const adapter = new JsonWebhookAdapter();

  it('builds a JSON payload with entry + lines', async () => {
    const artifact = await adapter.build(ctx());
    const parsed = JSON.parse(artifact.body.toString('utf-8'));
    expect(parsed.entry.entryNumber).toBe('E0001');
    expect(parsed.lines).toHaveLength(2);
  });

  it('refuses delivery when no URL configured', async () => {
    const artifact = await adapter.build(ctx());
    const r = await adapter.deliver(ctx(), artifact);
    expect(r.delivered).toBe(false);
    expect(r.error).toMatch(/url is required/i);
  });

  it('returns delivered=true on 2xx, with response summary', async () => {
    const artifact = await adapter.build(ctx({ publicConfig: { url: 'https://example.test/x' } }));
    const fetchMock = jest
      .spyOn(globalThis as any, 'fetch')
      .mockResolvedValue({
        ok: true,
        status: 202,
        text: async () => 'queued',
      } as any);
    try {
      const r = await adapter.deliver(
        ctx({ publicConfig: { url: 'https://example.test/x' } }),
        artifact,
      );
      expect(r.delivered).toBe(true);
      expect(r.responseSummary?.status).toBe(202);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('ProviderProfileAdapter', () => {
  const adapter = new ProviderProfileAdapter();

  it('applies field mapping profile to rename keys', async () => {
    const artifact = await adapter.build(
      ctx({
        adapterType: 'magaya_acelynk',
        fieldMappingProfile: {
          'entry.entryNumber': 'EntryNum',
          'line.htsNumber': 'HTS',
        },
      }),
    );
    const parsed = JSON.parse(artifact.body.toString('utf-8'));
    expect(parsed.entry.EntryNum).toBe('E0001');
    expect(parsed.lines[0].HTS).toBe('6109.10.00');
    expect(parsed.lines[0].htsNumber).toBeUndefined();
  });

  it('falls back to passthrough when no mapping configured', async () => {
    const artifact = await adapter.build(ctx({ adapterType: 'descartes' }));
    const parsed = JSON.parse(artifact.body.toString('utf-8'));
    expect(parsed.entry.entryNumber).toBe('E0001');
  });
});
