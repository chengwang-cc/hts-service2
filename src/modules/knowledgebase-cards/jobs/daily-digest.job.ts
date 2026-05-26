import { Injectable, Logger } from '@nestjs/common';
import { RuleReviewAlertService } from '../services/rule-review-alert.service';
import { AlertNotifierService } from '../services/alert-notifier.service';

/**
 * DailyDigestJob (Phase 8, P8.T11).
 *
 * Aggregates open `rule_review_alert` rows created in the last 24h and
 * renders an HTML digest. Email delivery hookup is a follow-up — for
 * now the rendered body is logged + optionally posted to whatever
 * notification channel the operator wires up.
 *
 * The intent is to surface alerts proactively so a CSMS update that
 * affects 4 rules doesn't sit unresolved while operators are heads-
 * down on something else.
 */
export interface DigestResult {
  alertCount: number;
  ruleCount: number;
  body: string;
}

@Injectable()
export class DailyDigestJob {
  private readonly logger = new Logger(DailyDigestJob.name);

  constructor(
    private readonly alerts: RuleReviewAlertService,
    private readonly notifier: AlertNotifierService,
  ) {}

  async runOnce(): Promise<DigestResult> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const alerts = await this.alerts.listSinceForDigest(since);
    const ruleIds = Array.from(new Set(alerts.map((a) => a.ruleId)));
    const body = this.renderHtml(alerts, since);

    if (alerts.length === 0) {
      this.logger.debug('daily-digest: 0 alerts in window — skipping');
      return { alertCount: 0, ruleCount: 0, body };
    }

    this.logger.log(
      `daily-digest: ${alerts.length} alert(s) across ${ruleIds.length} rule(s) since ${since.toISOString()}`,
    );

    await this.notifier.notify({ htmlBody: body, alerts });

    return { alertCount: alerts.length, ruleCount: ruleIds.length, body };
  }

  private renderHtml(
    alerts: Array<{
      ruleId: string;
      cardKey: string;
      diffSummary: string | null;
      previousHash: string | null;
      newHash: string;
      createdAt: Date;
    }>,
    since: Date,
  ): string {
    const lines: string[] = [];
    lines.push(
      `<h2>Exception-rule review alerts since ${since.toISOString()}</h2>`,
    );
    if (alerts.length === 0) {
      lines.push('<p>No new alerts in this window.</p>');
      return lines.join('\n');
    }
    lines.push(
      `<p>${alerts.length} alert(s) across ${new Set(alerts.map((a) => a.ruleId)).size} rule(s).</p>`,
    );
    const byRule = new Map<string, typeof alerts>();
    for (const a of alerts) {
      const bucket = byRule.get(a.ruleId) ?? [];
      bucket.push(a);
      byRule.set(a.ruleId, bucket);
    }
    for (const [ruleId, rows] of byRule.entries()) {
      lines.push(`<h3>${escapeHtml(ruleId)}</h3><ul>`);
      for (const a of rows) {
        const ts = a.createdAt.toISOString();
        lines.push(
          `<li><strong>${escapeHtml(a.cardKey)}</strong> — ${escapeHtml(a.diffSummary ?? 'no diff summary')} <em>(at ${ts})</em></li>`,
        );
      }
      lines.push('</ul>');
    }
    return lines.join('\n');
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
