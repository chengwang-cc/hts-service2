import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationAdapter,
  NotificationMessage,
  NotificationResult,
} from '../notification.service';

/**
 * R2-B-01 — generic HTTP-driven mailer adapter. Production deploys point
 * this at a Postmark / Resend / SendGrid API or an internal Lambda wrapping
 * SES. Configured via:
 *
 *   NOTIFICATION_HTTP_ENDPOINT      — full URL the adapter POSTs to.
 *   NOTIFICATION_HTTP_AUTH_HEADER   — value for the Authorization header
 *                                      (e.g. "Bearer xxx" or "Basic xxx").
 *   NOTIFICATION_HTTP_FROM          — From: address (header), default
 *                                      "no-reply@hts.local".
 *   NOTIFICATION_HTTP_TIMEOUT_MS    — request timeout (default 8000).
 *
 * The payload is provider-neutral so the receiver can normalise it to its
 * own format:
 *   { templateKey, subject, bodyText, bodyHtml?, from, to, context }
 */
@Injectable()
export class HttpMailerNotificationAdapter extends NotificationAdapter {
  readonly providerKey = 'http-mailer';
  private readonly logger = new Logger(HttpMailerNotificationAdapter.name);
  private readonly endpoint: string;
  private readonly authHeader: string;
  private readonly from: string;
  private readonly timeoutMs: number;

  constructor() {
    super();
    this.endpoint = process.env.NOTIFICATION_HTTP_ENDPOINT ?? '';
    this.authHeader = process.env.NOTIFICATION_HTTP_AUTH_HEADER ?? '';
    this.from = process.env.NOTIFICATION_HTTP_FROM ?? 'no-reply@hts.local';
    this.timeoutMs = Number(process.env.NOTIFICATION_HTTP_TIMEOUT_MS ?? 8000);
    if (!this.endpoint) {
      this.logger.warn(
        'HttpMailerNotificationAdapter has no NOTIFICATION_HTTP_ENDPOINT — send() will return delivered=false',
      );
    }
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    if (!this.endpoint) {
      return {
        delivered: false,
        provider: this.providerKey,
        error: 'NOTIFICATION_HTTP_ENDPOINT not configured',
      };
    }
    if (!message.recipient.email) {
      return {
        delivered: false,
        provider: this.providerKey,
        error: 'No recipient email',
      };
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.authHeader) headers.authorization = this.authHeader;
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          templateKey: message.templateKey,
          subject: message.subject,
          bodyText: message.bodyText,
          bodyHtml: message.bodyHtml,
          from: this.from,
          to: message.recipient.email,
          context: message.context ?? {},
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          delivered: false,
          provider: this.providerKey,
          error: `Mailer responded ${response.status}: ${body.slice(0, 200)}`,
        };
      }
      let messageId: string | undefined;
      try {
        const payload = (await response.json()) as { messageId?: string };
        messageId = payload?.messageId;
      } catch {
        // Provider may return 204 / non-JSON success.
      }
      return {
        delivered: true,
        provider: this.providerKey,
        messageId,
      };
    } catch (err) {
      return {
        delivered: false,
        provider: this.providerKey,
        error: (err as Error).message,
      };
    }
  }
}
