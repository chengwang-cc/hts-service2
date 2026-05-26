import { Injectable, Logger } from '@nestjs/common';
import type { RuleReviewAlertEntity } from '../entities/rule-review-alert.entity';

export interface AlertAdvisory {
  advise(alert: RuleReviewAlertEntity): Promise<Record<string, unknown>>;
}

@Injectable()
export class NoopAlertAdvisoryService implements AlertAdvisory {
  async advise(alert: RuleReviewAlertEntity): Promise<Record<string, unknown>> {
    return {
      enabled: false,
      alertId: alert.id,
      ruleId: alert.ruleId,
      cardKey: alert.cardKey,
      summary:
        'AI advisory is disabled; review the changed source and linked rules manually.',
    };
  }
}

@Injectable()
export class AlertAdvisoryService implements AlertAdvisory {
  private readonly logger = new Logger(AlertAdvisoryService.name);
  private delegate: AlertAdvisory;

  constructor() {
    this.delegate = new NoopAlertAdvisoryService();
  }

  configureDelegate(delegate: AlertAdvisory): void {
    this.delegate = delegate;
    this.logger.log(`alert advisory configured: ${delegate.constructor.name}`);
  }

  advise(alert: RuleReviewAlertEntity): Promise<Record<string, unknown>> {
    return this.delegate.advise(alert);
  }
}
