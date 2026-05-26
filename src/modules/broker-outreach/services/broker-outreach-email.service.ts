import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { TelemetryService } from '../../observability/telemetry.service';

/**
 * Outbound email transport abstraction for the broker-outreach module.
 *
 * Default provider is `log-only` — every "send" is just logged. This
 * keeps tests and dev sane until a real provider (SendGrid, Postmark,
 * SES) is wired up. The interface is intentionally small so new
 * providers only need to implement `send`.
 *
 * A simple in-process suppression list keeps us from sending to
 * unsubscribed / suppressed addresses, again log-only.
 */
export interface OutreachEmailEnvelope {
  to: string;
  subject: string;
  body: string;
  campaignId?: string | null;
  leadId?: string | null;
  inviteId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface OutreachEmailSendResult {
  status: 'sent' | 'suppressed' | 'skipped';
  provider: string;
  messageId?: string | null;
  reason?: string | null;
}

export interface OutreachEmailProvider {
  readonly name: string;
  send(envelope: OutreachEmailEnvelope): Promise<OutreachEmailSendResult>;
}

@Injectable()
export class LogOnlyOutreachEmailProvider implements OutreachEmailProvider {
  readonly name = 'log-only';
  private readonly logger = new Logger(LogOnlyOutreachEmailProvider.name);

  async send(envelope: OutreachEmailEnvelope): Promise<OutreachEmailSendResult> {
    const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.logger.log(
      `outreach.email.log to=${envelope.to} subject="${envelope.subject}" campaign=${envelope.campaignId ?? '-'} invite=${envelope.inviteId ?? '-'}`,
    );
    return { status: 'sent', provider: this.name, messageId: id };
  }
}

@Injectable()
export class BrokerOutreachEmailService {
  private readonly logger = new Logger(BrokerOutreachEmailService.name);
  private readonly suppression = new Set<string>();

  constructor(
    private readonly provider: LogOnlyOutreachEmailProvider,
    @Optional() private readonly telemetry: TelemetryService | null = null,
  ) {}

  /**
   * Add an email to the suppression list. Future send() calls for that
   * address short-circuit with status=suppressed. Lower-case + trimmed.
   */
  suppress(email: string, reason: string = 'manual'): void {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      throw new BadRequestException('suppress: email is required');
    }
    this.suppression.add(normalized);
    this.logger.log(`outreach.email.suppress email=${normalized} reason=${reason}`);
  }

  unsuppress(email: string): boolean {
    const normalized = normalizeEmail(email);
    return this.suppression.delete(normalized);
  }

  isSuppressed(email: string): boolean {
    return this.suppression.has(normalizeEmail(email));
  }

  listSuppressed(): string[] {
    return Array.from(this.suppression).sort();
  }

  async send(envelope: OutreachEmailEnvelope): Promise<OutreachEmailSendResult> {
    const to = normalizeEmail(envelope.to);
    if (!to) {
      throw new BadRequestException('send: envelope.to is required');
    }
    if (this.isSuppressed(to)) {
      this.logger.warn(
        `outreach.email.blocked to=${to} reason=suppressed`,
      );
      this.telemetry?.countEvent('broker_outreach_email_send_total', {
        status: 'suppressed',
      });
      return {
        status: 'suppressed',
        provider: this.provider.name,
        reason: 'address suppressed',
      };
    }
    try {
      const result = await this.provider.send({ ...envelope, to });
      this.telemetry?.countEvent('broker_outreach_email_send_total', {
        status: result.status,
      });
      return result;
    } catch (e) {
      this.telemetry?.countEvent('broker_outreach_email_send_failures_total');
      throw e;
    }
  }
}

function normalizeEmail(email: string | undefined | null): string {
  return (email ?? '').trim().toLowerCase();
}
