import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import {
  AdapterArtifact,
  AdapterContext,
  AdapterDeliveryResult,
  BrokerExportAdapter,
} from './adapter.contract';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_LIMIT = 1;
const RETRY_BACKOFF_MS = 500;

@Injectable()
export class JsonWebhookAdapter implements BrokerExportAdapter {
  readonly key = 'json_webhook' as const;
  private readonly logger = new Logger(JsonWebhookAdapter.name);

  async build(ctx: AdapterContext): Promise<AdapterArtifact> {
    const payload = {
      entry: {
        id: ctx.entry.id,
        entryNumber: ctx.entry.entryNumber,
        entryType: ctx.entry.entryType,
        currency: ctx.entry.currency,
        totalValue: ctx.entry.totalValue,
        approvedAt: ctx.entry.approvedAt,
      },
      lines: ctx.lines.map((line) => ({
        lineNumber: line.lineNumber,
        sku: line.sku,
        description: line.description,
        htsNumber: line.htsNumber,
        countryOfOrigin: line.countryOfOrigin,
        quantity: line.quantity,
        unitOfMeasure: line.unitOfMeasure,
        unitValue: line.unitValue,
        totalValue: line.totalValue,
        currency: line.currency,
      })),
    };
    return {
      contentType: 'application/json',
      fileName: `entry-${ctx.entry.entryNumber || ctx.entry.id}.json`,
      body: Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'),
    };
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
        error: 'Adapter publicConfig.url is required for json_webhook',
      };
    }
    const secrets = ctx.decryptedSecrets ?? {};
    const timeoutMs = clampInt(
      config.timeoutMs as number | undefined,
      1000,
      30_000,
      DEFAULT_TIMEOUT_MS,
    );
    const retryLimit = clampInt(
      config.retryLimit as number | undefined,
      0,
      3,
      DEFAULT_RETRY_LIMIT,
    );

    const baseHeaders: Record<string, string> = {
      'content-type': 'application/json',
      'x-hts-event': 'broker.entry.export',
      'x-hts-adapter-id': ctx.adapter.id,
    };
    if (secrets.bearerToken) {
      baseHeaders.authorization = `Bearer ${secrets.bearerToken}`;
    } else if (secrets.basicAuth) {
      baseHeaders.authorization = `Basic ${Buffer.from(secrets.basicAuth).toString('base64')}`;
    }

    // HMAC signing — when a webhookSecret is configured, attach a per-request
    // signature plus a timestamp + nonce so receivers can defend against
    // replay (R0-B-02). Receivers should:
    //   1. Reject requests where |now - timestamp| > 5 minutes.
    //   2. Recompute HMAC-SHA256(`${timestamp}.${nonce}.${rawBody}`) and
    //      constant-time compare against the signature header.
    if (secrets.webhookSecret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = randomBytes(12).toString('hex');
      const signingPayload = `${timestamp}.${nonce}.${artifact.body.toString(
        'utf8',
      )}`;
      const sig = createHmac('sha256', secrets.webhookSecret)
        .update(signingPayload)
        .digest('hex');
      baseHeaders['x-hts-timestamp'] = timestamp;
      baseHeaders['x-hts-nonce'] = nonce;
      baseHeaders['x-hts-signature'] = `sha256=${sig}`;
    }

    let lastError: string | undefined;
    let lastResponseSummary: AdapterDeliveryResult['responseSummary'];
    const attempts = retryLimit + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: baseHeaders,
          body: new Uint8Array(artifact.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const responseText = await response.text().catch(() => '');
        lastResponseSummary = {
          status: response.status,
          ok: response.ok,
          bodyPreview: responseText.slice(0, 500),
        };
        if (response.ok) {
          return {
            delivered: true,
            requestSummary: {
              url,
              byteSize: artifact.body.byteLength,
              attempt,
              signed: Boolean(secrets.webhookSecret),
            },
            responseSummary: lastResponseSummary,
          };
        }
        lastError = `Webhook responded with ${response.status}`;
        if (!shouldRetry(response.status) || attempt === attempts) {
          break;
        }
      } catch (error) {
        lastError =
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : 'Webhook delivery failed with unknown error';
        if (attempt === attempts) break;
      }
      if (attempt < attempts) {
        await sleep(RETRY_BACKOFF_MS * attempt);
        this.logger.warn(
          `Webhook delivery retry ${attempt}/${retryLimit} for ${url}: ${lastError}`,
        );
      }
    }

    return {
      delivered: false,
      requestSummary: {
        url,
        byteSize: artifact.body.byteLength,
        attempt: attempts,
        signed: Boolean(secrets.webhookSecret),
      },
      responseSummary: lastResponseSummary,
      error: lastError ?? 'Webhook delivery failed',
    };
  }

  requiredFields(): string[] {
    return ['entry.id', 'line.lineNumber'];
  }
}

function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function shouldRetry(status: number): boolean {
  // 5xx and 429 are retryable; everything else is a permanent client error.
  return status >= 500 || status === 429;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
