import { Injectable, Logger } from '@nestjs/common';
import {
  AdapterArtifact,
  AdapterContext,
  AdapterDeliveryResult,
  BrokerExportAdapter,
} from './adapter.contract';
import { ProviderProfileAdapter } from './provider-profile.adapter';

/**
 * R2-C-02 — Descartes Customs Info Hub adapter.
 *
 * UNTESTED AGAINST PRODUCTION VENDOR SANDBOX.
 *
 * Descartes Customs APIs use JSON over HTTPS with API-key auth and a
 * customer code that scopes every call to a Descartes account. Build path
 * reuses the provider-profile adapter; delivery POSTs with the documented
 * headers and falls into the same retry shape as the Magaya adapter.
 *
 * Required secrets:
 *   - descartesApiKey: API key issued by Descartes.
 *   - descartesCustomerCode: Descartes customer scope.
 *
 * Required publicConfig:
 *   - url: full Descartes endpoint.
 *   - timeoutMs, retryLimit: optional.
 */
@Injectable()
export class DescartesAdapter implements BrokerExportAdapter {
  readonly key = 'descartes' as const;
  private readonly logger = new Logger(DescartesAdapter.name);

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
      return { delivered: false, error: 'Descartes adapter publicConfig.url is required' };
    }
    const secrets = ctx.decryptedSecrets ?? {};
    if (!secrets.descartesApiKey || !secrets.descartesCustomerCode) {
      return {
        delivered: false,
        error: 'Descartes adapter requires secrets.descartesApiKey + secrets.descartesCustomerCode',
      };
    }

    const timeoutMs = clampInt(config.timeoutMs as number | undefined, 1000, 30000, 15000);
    const retryLimit = clampInt(config.retryLimit as number | undefined, 0, 5, 2);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': secrets.descartesApiKey,
      'x-customer-code': secrets.descartesCustomerCode,
    };

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
          providerReference: extractDescartesRef(responseText),
        };
        if (response.ok) {
          return {
            delivered: true,
            requestSummary: { url, attempt, byteSize: artifact.body.byteLength, provider: 'descartes' },
            responseSummary: lastResponseSummary,
          };
        }
        lastError = `Descartes responded ${response.status}`;
        if (!isRetryable(response.status) || attempt === attempts) break;
      } catch (err) {
        lastError = err instanceof Error ? `${err.name}: ${err.message}` : 'Descartes delivery failed';
        if (attempt === attempts) break;
      }
      if (attempt < attempts) {
        await sleep(500 * attempt);
        this.logger.warn(`Descartes delivery retry ${attempt}/${retryLimit}: ${lastError}`);
      }
    }

    return {
      delivered: false,
      requestSummary: { url, attempt: attempts },
      responseSummary: lastResponseSummary,
      error: lastError ?? 'Descartes delivery failed',
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

function extractDescartesRef(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return (parsed.referenceId ?? parsed.descartesId ?? parsed.requestId) as
      | string
      | undefined;
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
