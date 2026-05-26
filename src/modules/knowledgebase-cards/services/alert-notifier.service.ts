import { Injectable, Logger } from '@nestjs/common';
import type { RuleReviewAlertEntity } from '../entities/rule-review-alert.entity';

/**
 * AlertNotifier — abstraction for delivering the daily-digest body.
 *
 * Phase 8 ships `LogOnlyAlertNotifier` as the default; an SMTP /
 * Slack / Teams integration plugs in by providing its own
 * `AlertNotifier` and overriding the provider token in
 * `KnowledgebaseCardsModule`.
 *
 * The abstraction takes a rendered HTML body + the underlying alerts
 * — implementations can use either depending on their channel
 * (HTML for email; alerts list for richer Slack blocks, etc.).
 */
export interface AlertNotifier {
  notify(args: {
    htmlBody: string;
    alerts: Array<Pick<RuleReviewAlertEntity, 'ruleId' | 'cardKey' | 'diffSummary' | 'createdAt'>>;
    quarter?: string;
  }): Promise<void>;
}

export const ALERT_NOTIFIER_TOKEN = 'ALERT_NOTIFIER';

@Injectable()
export class LogOnlyAlertNotifier implements AlertNotifier {
  private readonly logger = new Logger('AlertNotifier:Log');

  async notify(args: {
    htmlBody: string;
    alerts: Array<Pick<RuleReviewAlertEntity, 'ruleId' | 'cardKey' | 'diffSummary' | 'createdAt'>>;
  }): Promise<void> {
    this.logger.log(
      `alert.notify.log channel=log alerts=${args.alerts.length} bytes=${args.htmlBody.length}`,
    );
    // Body intentionally not dumped to logs by default — set
    // ALERT_LOG_BODY=true if local debugging needs it.
    if (process.env.ALERT_LOG_BODY === 'true') {
      this.logger.debug(args.htmlBody);
    }
  }
}

@Injectable()
export class AlertNotifierService implements AlertNotifier {
  private readonly logger = new Logger(AlertNotifierService.name);
  private delegate: AlertNotifier;

  constructor() {
    this.delegate = new LogOnlyAlertNotifier();
  }

  /**
   * Swap the delivery channel at runtime. Used by a mailer / Slack
   * adapter module that depends on its own SDK without bleeding the
   * dependency into this module.
   */
  configureDelegate(notifier: AlertNotifier): void {
    this.delegate = notifier;
    this.logger.log(`alert notifier configured: ${notifier.constructor.name}`);
  }

  notify(args: {
    htmlBody: string;
    alerts: Array<Pick<RuleReviewAlertEntity, 'ruleId' | 'cardKey' | 'diffSummary' | 'createdAt'>>;
    quarter?: string;
  }): Promise<void> {
    return this.delegate.notify(args);
  }
}
