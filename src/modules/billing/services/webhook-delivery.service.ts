import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface WebhookDeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
  durationMs: number;
}

/**
 * Minimal HMAC-signed webhook POST with bounded retry.
 *
 * Used by cost-alert firings (and any future "tell the partner something
 * happened" hook). Deliberately small: no queue persistence yet —
 * delivery is fire-and-forget on the rollup-worker thread with a hard
 * timeout per attempt so a slow partner endpoint can't block the
 * monthly rollup cron.
 *
 * Signature header
 * ----------------
 *   X-HTS-Signature: t=<unix-seconds>,v1=<hex(hmac-sha256(secret, t + "." + body))>
 *
 * Same shape as Stripe's webhook signing so partners can lean on
 * existing libraries / docs to verify. Replay protection is the
 * timestamp; partners are expected to reject signatures older than 5
 * minutes.
 *
 * Future: when v2 needs durable retry, move dispatch into a pg-boss
 * queue with a dead-letter table. For v1, 3 attempts with exponential
 * backoff + a `[CostAlertWebhook] FAILED` log line is enough.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  private readonly DEFAULT_TIMEOUT_MS = 5_000;
  private readonly MAX_ATTEMPTS = 3;

  async deliver(
    url: string,
    payload: Record<string, unknown>,
    secret: string,
  ): Promise<WebhookDeliveryResult> {
    const body = JSON.stringify(payload);
    const startedAt = Date.now();

    let lastError = '';
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= this.MAX_ATTEMPTS; attempt++) {
      const result = await this.attemptOnce(url, body, secret);
      if (result.ok) {
        return {
          ok: true,
          status: result.status,
          durationMs: Date.now() - startedAt,
        };
      }
      lastError = result.error ?? lastError;
      lastStatus = result.status ?? lastStatus;
      // Don't retry 4xx — they won't succeed by trying again.
      if (result.status && result.status >= 400 && result.status < 500) {
        break;
      }
      if (attempt < this.MAX_ATTEMPTS) {
        await this.sleep(200 * 2 ** (attempt - 1));
      }
    }

    this.logger.warn(
      `[CostAlertWebhook] FAILED url=${this.redactUrl(url)} status=${lastStatus ?? 'n/a'} err=${lastError}`,
    );
    return {
      ok: false,
      status: lastStatus,
      error: lastError,
      durationMs: Date.now() - startedAt,
    };
  }

  private async attemptOnce(
    url: string,
    body: string,
    secret: string,
  ): Promise<{ ok: boolean; status?: number; error?: string }> {
    const ts = Math.floor(Date.now() / 1000);
    const signature = this.sign(secret, ts, body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HTS-Signature': signature,
          'User-Agent': 'usahts-webhook/1',
        },
        body,
        signal: controller.signal,
      });
      const ok = res.status >= 200 && res.status < 300;
      return ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      return { ok: false, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }

  /** `t=<unix>,v1=<hex hmac>` — Stripe-shape so partner libs can verify. */
  private sign(secret: string, ts: number, body: string): string {
    const payload = `${ts}.${body}`;
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `t=${ts},v1=${hmac}`;
  }

  private redactUrl(u: string): string {
    try {
      const parsed = new URL(u);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return '[invalid-url]';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
