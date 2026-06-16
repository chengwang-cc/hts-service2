import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CostAlertService } from './cost-alert.service';
import { CostAlertConfigEntity } from '../entities/cost-alert-config.entity';
import { CostAlertEventEntity } from '../entities/cost-alert-event.entity';
import { UpsertCostAlertDto } from '../dto/cost-alert.dto';
import { WebhookDeliveryService } from './webhook-delivery.service';

const ORG = '11111111-1111-1111-1111-111111111111';

const makeConfigRepo = (initial: Partial<CostAlertConfigEntity>[] = []): any => {
  const rows: any[] = initial.map((r) => ({ ...r }));
  return {
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) => r.organizationId === where.organizationId) ?? null,
    ),
    create: jest.fn((data: any) => ({ ...data, id: `cfg-${rows.length + 1}` })),
    save: jest.fn(async (cfg: any) => {
      const existing = rows.findIndex((r) => r.id === cfg.id);
      if (existing >= 0) {
        rows[existing] = { ...rows[existing], ...cfg };
      } else {
        rows.push(cfg);
      }
      return cfg;
    }),
    _rows: rows,
  };
};

const makeEventRepo = (initial: Partial<CostAlertEventEntity>[] = []): any => {
  const rows: any[] = initial.map((r) => ({ ...r }));
  return {
    findOne: jest.fn(async ({ where }: any) =>
      rows.find(
        (r) =>
          (where.id ? r.id === where.id : true) &&
          (where.organizationId ? r.organizationId === where.organizationId : true) &&
          (where.acknowledgedAt !== undefined
            ? where.acknowledgedAt?._type === 'IsNull'
              ? r.acknowledgedAt == null
              : r.acknowledgedAt === where.acknowledgedAt
            : true),
      ) ?? null,
    ),
    save: jest.fn(async (e: any) => {
      const i = rows.findIndex((r) => r.id === e.id);
      if (i >= 0) rows[i] = { ...rows[i], ...e };
      else rows.push(e);
      return e;
    }),
    count: jest.fn(async () => rows.length),
    _rows: rows,
  };
};

const makeDataSource = () => ({ query: jest.fn() });
const makeWebhooks = (): jest.Mocked<WebhookDeliveryService> =>
  ({
    deliver: jest.fn(async () => ({ ok: true, status: 200, durationMs: 5 })),
  }) as any;

const dto = (over: Partial<UpsertCostAlertDto> = {}): UpsertCostAlertDto => ({
  thresholdUsd: 50,
  channels: ['in_app'],
  ...over,
});

describe('CostAlertService — CRUD', () => {
  it('returns null config + null openEvent when nothing configured', async () => {
    const svc = new CostAlertService(makeConfigRepo(), makeEventRepo(), makeDataSource() as any, makeWebhooks());
    const result = await svc.getForOrganization(ORG);
    expect(result.config).toBeNull();
    expect(result.openEvent).toBeNull();
  });

  it('creates a new config, no webhook secret when channel is in_app only', async () => {
    const configs = makeConfigRepo();
    const svc = new CostAlertService(configs, makeEventRepo(), makeDataSource() as any, makeWebhooks());
    const result = await svc.upsert(ORG, dto());
    expect(result.config.thresholdUsd).toBe(50);
    expect(result.config.enabled).toBe(true);
    expect(result.config.webhookConfigured).toBe(false);
    expect(result.revealedWebhookSecret).toBeNull();
  });

  it('rejects empty channels array', async () => {
    const svc = new CostAlertService(makeConfigRepo(), makeEventRepo(), makeDataSource() as any, makeWebhooks());
    await expect(svc.upsert(ORG, dto({ channels: [] as any }))).rejects.toThrow(BadRequestException);
  });

  it('rejects webhook channel without a URL', async () => {
    const svc = new CostAlertService(makeConfigRepo(), makeEventRepo(), makeDataSource() as any, makeWebhooks());
    await expect(svc.upsert(ORG, dto({ channels: ['webhook'] }))).rejects.toThrow(BadRequestException);
  });

  it('generates a webhook secret the first time webhook channel is added (revealed once)', async () => {
    const configs = makeConfigRepo();
    const svc = new CostAlertService(configs, makeEventRepo(), makeDataSource() as any, makeWebhooks());
    const result = await svc.upsert(ORG, dto({
      channels: ['in_app', 'webhook'],
      webhookUrl: 'https://example.com/cb',
    }));
    expect(result.revealedWebhookSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(result.config.webhookConfigured).toBe(true);
    expect(result.config.webhookUrl).toBe('https://example.com/cb');
  });

  it('does NOT rotate the secret when re-saving the same URL', async () => {
    const configs = makeConfigRepo();
    const svc = new CostAlertService(configs, makeEventRepo(), makeDataSource() as any, makeWebhooks());

    const first = await svc.upsert(ORG, dto({
      channels: ['webhook', 'in_app'],
      webhookUrl: 'https://example.com/cb',
    }));
    const original = first.revealedWebhookSecret!;

    const second = await svc.upsert(ORG, dto({
      thresholdUsd: 75,
      channels: ['webhook', 'in_app'],
      webhookUrl: 'https://example.com/cb',
    }));
    expect(second.revealedWebhookSecret).toBeNull();
    expect(configs._rows[0].webhookSecret).toBe(original);
  });

  it('rotates the secret when the URL changes', async () => {
    const configs = makeConfigRepo();
    const svc = new CostAlertService(configs, makeEventRepo(), makeDataSource() as any, makeWebhooks());

    const first = await svc.upsert(ORG, dto({
      channels: ['webhook'],
      webhookUrl: 'https://example.com/cb1',
    }));
    const second = await svc.upsert(ORG, dto({
      channels: ['webhook'],
      webhookUrl: 'https://example.com/cb2',
    }));
    expect(second.revealedWebhookSecret).not.toBeNull();
    expect(second.revealedWebhookSecret).not.toBe(first.revealedWebhookSecret);
  });

  it('clears the webhook secret when webhook channel is removed', async () => {
    const configs = makeConfigRepo();
    const svc = new CostAlertService(configs, makeEventRepo(), makeDataSource() as any, makeWebhooks());

    await svc.upsert(ORG, dto({
      channels: ['webhook'],
      webhookUrl: 'https://example.com/cb',
    }));
    await svc.upsert(ORG, dto({ channels: ['in_app'] }));
    expect(configs._rows[0].webhookSecret).toBeNull();
  });

  it('disable() flips enabled=false', async () => {
    const configs = makeConfigRepo([{ id: 'c1', organizationId: ORG, enabled: true }]);
    const svc = new CostAlertService(configs, makeEventRepo(), makeDataSource() as any, makeWebhooks());
    await svc.disable(ORG);
    expect(configs._rows[0].enabled).toBe(false);
  });

  it('disable() throws NotFound when no config exists', async () => {
    const svc = new CostAlertService(makeConfigRepo(), makeEventRepo(), makeDataSource() as any, makeWebhooks());
    await expect(svc.disable(ORG)).rejects.toThrow(NotFoundException);
  });
});

describe('CostAlertService — ack', () => {
  it('sets acknowledgedAt on the event', async () => {
    const events = makeEventRepo([
      { id: 'e1', organizationId: ORG, acknowledgedAt: null, createdAt: new Date() },
    ]);
    const svc = new CostAlertService(makeConfigRepo(), events, makeDataSource() as any, makeWebhooks());
    await svc.acknowledgeEvent(ORG, 'e1');
    expect(events._rows[0].acknowledgedAt).toBeInstanceOf(Date);
  });

  it('throws NotFound for an unknown event', async () => {
    const svc = new CostAlertService(makeConfigRepo(), makeEventRepo(), makeDataSource() as any, makeWebhooks());
    await expect(svc.acknowledgeEvent(ORG, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('is idempotent — ack-ing twice does not overwrite the original timestamp', async () => {
    const original = new Date('2026-06-10T10:00:00.000Z');
    const events = makeEventRepo([
      { id: 'e1', organizationId: ORG, acknowledgedAt: original, createdAt: new Date() },
    ]);
    const svc = new CostAlertService(makeConfigRepo(), events, makeDataSource() as any, makeWebhooks());
    await svc.acknowledgeEvent(ORG, 'e1');
    expect(events._rows[0].acknowledgedAt).toBe(original);
  });
});

describe('CostAlertService — detectAndFireCrossings', () => {
  it('returns [] and does not fire webhooks when no crossings', async () => {
    const ds: any = { query: jest.fn().mockResolvedValueOnce([]) };
    const webhooks = makeWebhooks();
    const svc = new CostAlertService(makeConfigRepo(), makeEventRepo(), ds, webhooks);
    const result = await svc.detectAndFireCrossings();
    expect(result).toEqual([]);
    expect(webhooks.deliver).not.toHaveBeenCalled();
  });

  it('marks in_app delivery and skips webhook when webhook channel is not configured', async () => {
    const ds: any = {
      query: jest.fn()
        // 1st call: the CTE returning crossed configs
        .mockResolvedValueOnce([
          {
            event_id: 'evt-1',
            organization_id: ORG,
            threshold_usd: '50.00',
            observed_cost_usd: '52.10',
            period: '2026-06-01',
            webhook_url: null,
            webhook_secret: null,
            channels: ['in_app'],
          },
        ])
        // 2nd call: UPDATE last_fired
        .mockResolvedValueOnce({})
        // 3rd call: recordDelivery UPDATE
        .mockResolvedValueOnce({}),
    };
    const webhooks = makeWebhooks();
    const svc = new CostAlertService(makeConfigRepo(), makeEventRepo(), ds, webhooks);
    const result = await svc.detectAndFireCrossings();

    expect(result).toHaveLength(1);
    expect(result[0].webhookQueued).toBe(false);
    expect(webhooks.deliver).not.toHaveBeenCalled();
    // 3 queries: detect+insert, update last_fired, record delivery
    expect(ds.query).toHaveBeenCalledTimes(3);
  });

  it('queues webhook delivery when webhook channel is configured', async () => {
    const ds: any = {
      query: jest.fn()
        .mockResolvedValueOnce([
          {
            event_id: 'evt-2',
            organization_id: ORG,
            threshold_usd: '50.00',
            observed_cost_usd: '60.00',
            period: '2026-06-01',
            webhook_url: 'https://example.com/cb',
            webhook_secret: 'a'.repeat(64),
            channels: ['in_app', 'webhook'],
          },
        ])
        .mockResolvedValueOnce({}) // update last_fired
        .mockResolvedValue({}),    // any subsequent recordDelivery
    };
    const webhooks = makeWebhooks();
    const svc = new CostAlertService(makeConfigRepo(), makeEventRepo(), ds, webhooks);

    const result = await svc.detectAndFireCrossings();
    expect(result[0].webhookQueued).toBe(true);

    // detectAndFireCrossings dispatches webhook fire-and-forget; flush
    // microtasks so the assertion sees it.
    await new Promise((r) => setImmediate(r));
    expect(webhooks.deliver).toHaveBeenCalledWith(
      'https://example.com/cb',
      expect.objectContaining({
        type: 'cost_alert.threshold_crossed',
        organizationId: ORG,
        thresholdUsd: 50,
        observedCostUsd: 60,
      }),
      'a'.repeat(64),
    );
  });
});
