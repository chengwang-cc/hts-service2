import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

export interface NotificationRecipient {
  email?: string | null;
  userId?: string | null;
  organizationId?: string | null;
}

export interface NotificationMessage {
  /**
   * Stable template identifier — adapters can use this for branding,
   * deliverability tracking, or for routing in-app channels. Examples:
   * 'broker.task.created', 'marketplace.quote.expiring',
   * 'broker.client_portal.task_created'.
   */
  templateKey: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  recipient: NotificationRecipient;
  /** Structured context — adapters MAY pass to a templating engine. */
  context?: Record<string, unknown>;
}

export interface NotificationResult {
  delivered: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

export abstract class NotificationAdapter {
  abstract readonly providerKey: string;
  abstract send(message: NotificationMessage): Promise<NotificationResult>;
}

export const NOTIFICATION_ADAPTER = 'NOTIFICATION_ADAPTER' as const;

/**
 * Default no-op adapter — logs the message and returns delivered=true.
 * Used in dev/test and when a real provider hasn't been bound yet. The
 * production deploy rebinds NOTIFICATION_ADAPTER with an SES/Postmark/Slack
 * implementation.
 */
@Injectable()
export class LogNotificationAdapter extends NotificationAdapter {
  readonly providerKey = 'log';
  private readonly logger = new Logger(LogNotificationAdapter.name);

  async send(message: NotificationMessage): Promise<NotificationResult> {
    this.logger.log(
      `[notification:${message.templateKey}] to=${message.recipient.email ?? message.recipient.userId ?? '?'} subject="${message.subject}"`,
    );
    return { delivered: true, provider: this.providerKey };
  }
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Optional()
    @Inject(NOTIFICATION_ADAPTER)
    private readonly adapter: NotificationAdapter | null,
    private readonly defaultAdapter: LogNotificationAdapter,
  ) {
    const provider = (adapter ?? defaultAdapter).providerKey;
    this.logger.log(`Notification provider: ${provider}`);
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    const adapter = this.adapter ?? this.defaultAdapter;
    if (!message.recipient.email && !message.recipient.userId) {
      return {
        delivered: false,
        provider: adapter.providerKey,
        error: 'No recipient email or userId',
      };
    }
    try {
      return await adapter.send(message);
    } catch (err) {
      this.logger.warn(
        `Notification adapter ${adapter.providerKey} failed: ${(err as Error).message}`,
      );
      return {
        delivered: false,
        provider: adapter.providerKey,
        error: (err as Error).message,
      };
    }
  }
}
