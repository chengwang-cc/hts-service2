import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { CargoWiseAdapter } from '../../src/modules/broker-adapters/adapters/cargowise.adapter';
import { DescartesAdapter } from '../../src/modules/broker-adapters/adapters/descartes.adapter';
import { MagayaAcelynkAdapter } from '../../src/modules/broker-adapters/adapters/magaya-acelynk.adapter';
import { ProviderProfileAdapter } from '../../src/modules/broker-adapters/adapters/provider-profile.adapter';
import type { AdapterContext } from '../../src/modules/broker-adapters/adapters/adapter.contract';

const testOutboundPolicy = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
};

/**
 * R2-C-01..03 — exercise the vendor adapter HTTP shape against a local
 * test server. These tests confirm the adapters send the right auth
 * headers, retry on retryable errors, and stop on client errors. They do
 * NOT validate semantic correctness against the real vendor — that needs
 * sandbox credentials.
 */
describe('Vendor adapter shells (R2-C-01..03)', () => {
  let server: Server;
  let port: number;
  const seen: Array<{ headers: Record<string, string>; body: string }> = [];
  let responder: (req: any, res: any) => void;

  beforeEach(async () => {
    seen.length = 0;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        responder(req, res);
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  function mkCtx(
    adapterPublicConfig: Record<string, unknown>,
    secrets: Record<string, string>,
  ): AdapterContext {
    return {
      adapter: {
        id: 'adp-1',
        organizationId: 'org-1',
        adapterType: 'json_webhook',
        publicConfig: {
          url: `http://127.0.0.1:${port}/hook`,
          ...adapterPublicConfig,
        },
      } as any,
      entry: { id: 'e1', entryNumber: 'E1', currency: 'USD' } as any,
      lines: [
        { lineNumber: 1, htsNumber: '6109.10.00', countryOfOrigin: 'VN' },
      ] as any,
      decryptedSecrets: secrets,
    };
  }

  it('MagayaAcelynkAdapter sends Bearer token + account header', async () => {
    responder = (_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ shipmentId: 'MAG-42' }));
    };
    const adapter = new MagayaAcelynkAdapter(
      new ProviderProfileAdapter(),
      testOutboundPolicy as any,
    );
    const ctx = mkCtx(
      {},
      {
        acelynkApiToken: 'token-xyz',
        acelynkAccountId: '7777',
      },
    );
    const artifact = await adapter.build(ctx);
    const result = await adapter.deliver(ctx, artifact);
    expect(result.delivered).toBe(true);
    expect(seen[0].headers.authorization).toBe('Bearer token-xyz');
    expect(seen[0].headers['x-acelynk-account']).toBe('7777');
    expect(result.responseSummary?.providerReference).toBe('MAG-42');
  });

  it('MagayaAcelynkAdapter retries on 5xx and gives up on 4xx', async () => {
    let calls = 0;
    responder = (_req, res) => {
      calls += 1;
      if (calls === 1) {
        res.statusCode = 503;
        res.end('busy');
        return;
      }
      res.statusCode = 400;
      res.end('bad');
    };
    const adapter = new MagayaAcelynkAdapter(
      new ProviderProfileAdapter(),
      testOutboundPolicy as any,
    );
    const ctx = mkCtx(
      { retryLimit: 2 },
      {
        acelynkApiToken: 'tok',
      },
    );
    const artifact = await adapter.build(ctx);
    const result = await adapter.deliver(ctx, artifact);
    expect(result.delivered).toBe(false);
    expect(seen.length).toBe(2); // retried once (5xx), gave up on 400
  });

  it('DescartesAdapter sends x-api-key + x-customer-code', async () => {
    responder = (_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ referenceId: 'DES-101' }));
    };
    const adapter = new DescartesAdapter(
      new ProviderProfileAdapter(),
      testOutboundPolicy as any,
    );
    const ctx = mkCtx(
      {},
      {
        descartesApiKey: 'desc-key',
        descartesCustomerCode: 'CUST01',
      },
    );
    const artifact = await adapter.build(ctx);
    const result = await adapter.deliver(ctx, artifact);
    expect(result.delivered).toBe(true);
    expect(seen[0].headers['x-api-key']).toBe('desc-key');
    expect(seen[0].headers['x-customer-code']).toBe('CUST01');
    expect(result.responseSummary?.providerReference).toBe('DES-101');
  });

  it('CargoWiseAdapter posts XML + Basic auth + detects SOAP faults', async () => {
    responder = (_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/xml');
      // Even on a 200, a CargoWise fault payload means failure.
      res.end(
        '<envelope><faultstring>InvalidShipment: missing LRN</faultstring></envelope>',
      );
    };
    const adapter = new CargoWiseAdapter(testOutboundPolicy as any);
    const ctx = mkCtx(
      { clientCode: 'TST' },
      {
        cargowiseUsername: 'ABC-EBL',
        cargowisePassword: '00000000-0000-0000-0000-000000000000',
      },
    );
    const artifact = await adapter.build(ctx);
    expect(artifact.contentType).toBe('application/xml');
    expect(artifact.body.toString()).toContain('<Code>TST</Code>');
    const result = await adapter.deliver(ctx, artifact);
    expect(result.delivered).toBe(false);
    expect(result.error).toMatch(/InvalidShipment/);
    expect(seen[0].headers.authorization).toMatch(/^Basic /);
    expect(seen[0].headers['content-type']).toBe('application/xml');
  });
});
