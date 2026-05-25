import { Injectable, Logger } from '@nestjs/common';
import {
  AdapterArtifact,
  AdapterContext,
  AdapterDeliveryResult,
  BrokerExportAdapter,
} from './adapter.contract';
import { ProviderProfileAdapter } from './provider-profile.adapter';

/**
 * R2-C-01 — Magaya ACELYNK adapter.
 *
 * UNTESTED AGAINST PRODUCTION VENDOR SANDBOX.
 *
 * Magaya ACELYNK exposes a JSON-over-HTTPS API with token-based auth.
 * Build path reuses the provider-profile adapter (which maps the broker
 * entry into a vendor-agnostic JSON envelope already supported by the
 * field-mapping profile), then POSTs to the configured ACELYNK endpoint.
 *
 * Required secrets (encrypted in broker_adapters.encrypted_config):
 *   - acelynkApiToken: Bearer token issued by Magaya.
 *   - acelynkAccountId: numeric account id (sent as X-Acelynk-Account header).
 *
 * Required publicConfig:
 *   - url: full Magaya endpoint (e.g. https://api.acelynk.com/v1/shipments).
 *   - timeoutMs: optional; default 15000.
 *   - retryLimit: optional; default 2.
 */
@Injectable()
export class MagayaAcelynkAdapter implements BrokerExportAdapter {
  readonly key = 'magaya_acelynk' as const;
  private readonly logger = new Logger(MagayaAcelynkAdapter.name);

  constructor(private readonly provider: ProviderProfileAdapter) {}

  build(ctx: AdapterContext): Promise<AdapterArtifact> {
    return this.provider.build(ctx);
  }

  async deliver(
    ctx: AdapterContext,
    artifact: AdapterArtifact,
  ): Promise<AdapterDeliveryResult> {
    const config = ctx.adapter.publicConfig ?? {};
    const url = typeof config.url === 'string' ? config.url : null;
    if (!url) {
      return {
        delivered: false,
        error: 'Magaya adapter publicConfig.url is required',
      };
    }
    const secrets = ctx.decryptedSecrets ?? {};
    if (!secrets.acelynkApiToken) {
      return {
        delivered: false,
        error: 'Magaya adapter requires secrets.acelynkApiToken',
      };
    }

    const timeoutMs = clampInt(config.timeoutMs as number | undefined, 1000, 30000, 15000);
    const retryLimit = clampInt(config.retryLimit as number | undefined, 0, 5, 2);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${secrets.acelynkApiToken}`,
    };
    if (secrets.acelynkAccountId) {
      headers['x-acelynk-account'] = secrets.acelynkAccountId;
    }

    let lastError: string | undefined;
    let lastResponseSummary: AdapterDeliveryResult['responseSummary'];
    const attempts = retryLimit + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: new Uint8Array(artifact.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const responseText = await response.text().catch(() => '');
        lastResponseSummary = {
          status: response.status,
          ok: response.ok,
          bodyPreview: responseText.slice(0, 500),
          providerReference: extractProviderRef(responseText),
        };
        if (response.ok) {
          return {
            delivered: true,
            requestSummary: {
              url,
              attempt,
              byteSize: artifact.body.byteLength,
              provider: 'magaya_acelynk',
            },
            responseSummary: lastResponseSummary,
          };
        }
        lastError = `Magaya responded ${response.status}`;
        if (!isRetryable(response.status) || attempt === attempts) break;
      } catch (err) {
        lastError =
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : 'Magaya delivery failed with unknown error';
        if (attempt === attempts) break;
      }
      if (attempt < attempts) {
        await sleep(500 * attempt);
        this.logger.warn(
          `Magaya delivery retry ${attempt}/${retryLimit}: ${lastError}`,
        );
      }
    }

    return {
      delivered: false,
      requestSummary: { url, attempt: attempts },
      responseSummary: lastResponseSummary,
      error: lastError ?? 'Magaya delivery failed',
    };
  }

  requiredFields(): string[] {
    return [
      'entry.id',
      'entry.entryNumber',
      'line.lineNumber',
      'line.htsNumber',
      'line.countryOfOrigin',
      'line.totalValue',
    ];
  }
}

function extractProviderRef(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return (parsed.shipmentId ??
      parsed.referenceNumber ??
      parsed.acelynkId) as string | undefined;
  } catch {
    return undefined;
  }
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

function clampInt(
  v: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
