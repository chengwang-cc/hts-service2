import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { JsonWebhookAdapter } from '../../src/modules/broker-adapters/adapters/json-webhook.adapter';
import type { AdapterContext } from '../../src/modules/broker-adapters/adapters/adapter.contract';

describe('JsonWebhookAdapter HMAC + retry hardening (R0-B-02/03)', () => {
  let server: Server;
  let port: number;
  const requests: Array<{ headers: Record<string, string>; body: string }> = [];
  let responder: (req: any, res: any) => void;

  beforeEach(async () => {
    requests.length = 0;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        requests.push({
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        responder(req, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function buildCtx(secret: string | null): AdapterContext {
    return {
      adapter: {
        id: 'adp-1',
        publicConfig: { url: `http://127.0.0.1:${port}/hook` },
      } as any,
      entry: { id: 'e1', entryNumber: 'E1' } as any,
      lines: [] as any,
      decryptedSecrets: secret ? { webhookSecret: secret } : undefined,
    };
  }

  it('signs the payload with HMAC-SHA256 when webhookSecret is configured', async () => {
    responder = (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    };
    const adapter = new JsonWebhookAdapter();
    const ctx = buildCtx('s3cr3t');
    const artifact = await adapter.build(ctx);
    const result = await adapter.deliver(ctx, artifact);
    expect(result.delivered).toBe(true);
    expect(requests).toHaveLength(1);
    const headers = requests[0].headers;
    expect(headers['x-hts-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers['x-hts-timestamp']).toMatch(/^\d+$/);
    expect(headers['x-hts-nonce']).toMatch(/^[0-9a-f]{24}$/);
    const expected = createHmac('sha256', 's3cr3t')
      .update(
        `${headers['x-hts-timestamp']}.${headers['x-hts-nonce']}.${requests[0].body}`,
      )
      .digest('hex');
    expect(headers['x-hts-signature']).toBe(`sha256=${expected}`);
  });

  it('omits signature headers when no webhookSecret is configured', async () => {
    responder = (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    };
    const adapter = new JsonWebhookAdapter();
    const ctx = buildCtx(null);
    const artifact = await adapter.build(ctx);
    const result = await adapter.deliver(ctx, artifact);
    expect(result.delivered).toBe(true);
    expect(requests[0].headers['x-hts-signature']).toBeUndefined();
  });

  it('retries on 5xx and reports each attempt', async () => {
    let calls = 0;
    responder = (_req, res) => {
      calls += 1;
      if (calls < 2) {
        res.statusCode = 503;
        res.end('busy');
      } else {
        res.statusCode = 200;
        res.end('ok');
      }
    };
    const adapter = new JsonWebhookAdapter();
    const ctx = buildCtx(null);
    const artifact = await adapter.build(ctx);
    const result = await adapter.deliver(ctx, artifact);
    expect(result.delivered).toBe(true);
    expect((result.requestSummary as any).attempt).toBe(2);
    expect(requests).toHaveLength(2);
  });

  it('does not retry on a non-retryable client error (400)', async () => {
    responder = (_req, res) => {
      res.statusCode = 400;
      res.end('bad');
    };
    const adapter = new JsonWebhookAdapter();
    const ctx = buildCtx(null);
    const artifact = await adapter.build(ctx);
    const result = await adapter.deliver(ctx, artifact);
    expect(result.delivered).toBe(false);
    expect(requests).toHaveLength(1);
    expect(result.error).toMatch(/400/);
  });
});
