import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QueueService } from '../../queue/queue.service';

/**
 * Hourly anomaly check on each partner's error rate. Posts to a Slack
 * webhook (if configured) when any partner's last-hour error rate is
 * BOTH > 5% AND > 3σ above its 7d trailing baseline.
 *
 * Pure observation — never modifies request behavior. If the Slack webhook
 * isn't configured we log to stdout instead, so this stays useful in dev.
 *
 * Cron: '7 * * * *' — once an hour at minute 7, deliberately offset from
 * the rollup worker (minute 0/5/10/…) so the rollup catches up first.
 */
export const PARTNER_ANOMALY_ALERT_QUEUE = 'partner-anomaly-alert';

interface AnomalyRow {
  partner_id: string;
  slug: string | null;
  recent_requests: string;
  recent_errors: string;
  recent_error_rate: number;
  baseline_error_rate: number | null;
  baseline_stddev: number | null;
  z: number | null;
}

@Injectable()
export class PartnerAnomalyAlertWorker implements OnModuleInit {
  private readonly logger = new Logger(PartnerAnomalyAlertWorker.name);
  private readonly slackWebhook = process.env.PARTNER_ANOMALY_SLACK_WEBHOOK;

  constructor(
    private readonly queue: QueueService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(PARTNER_ANOMALY_ALERT_QUEUE, async () => {
      await this.runAlertCheck();
    });
    // singletonKey prevents pg-boss from queuing concurrent runs if Slack
    // posts are slow.
    await this.queue.scheduleJob(PARTNER_ANOMALY_ALERT_QUEUE, '7 * * * *', {}, {
      singletonKey: PARTNER_ANOMALY_ALERT_QUEUE,
    });
    this.logger.log(`Anomaly alert worker registered (cron: 7 * * * *, singleton)`);
  }

  async runAlertCheck(): Promise<void> {
    const rows: AnomalyRow[] = await this.ds.query(`
      WITH recent AS (
        SELECT
          partner_id,
          COUNT(*)::bigint AS recent_requests,
          COUNT(*) FILTER (WHERE status_code >= 400)::bigint AS recent_errors
        FROM api_usage_metrics
        WHERE timestamp >= now() - interval '1 hour'
          AND timestamp <  now()
          AND partner_id IS NOT NULL
        GROUP BY partner_id
      ),
      baseline_hours AS (
        SELECT
          partner_id,
          date_trunc('hour', timestamp) AS bucket,
          COUNT(*)::numeric AS requests,
          COUNT(*) FILTER (WHERE status_code >= 400)::numeric AS errors
        FROM api_usage_metrics
        WHERE timestamp >= now() - interval '8 days'
          AND timestamp <  now() - interval '1 hour'
          AND partner_id IS NOT NULL
        GROUP BY partner_id, date_trunc('hour', timestamp)
      ),
      baseline AS (
        SELECT
          partner_id,
          avg(CASE WHEN requests > 0 THEN errors / requests ELSE 0 END)::numeric AS baseline_error_rate,
          stddev_samp(CASE WHEN requests > 0 THEN errors / requests ELSE 0 END)::numeric AS baseline_stddev
        FROM baseline_hours
        GROUP BY partner_id
        HAVING COUNT(*) >= 24
      )
      SELECT
        r.partner_id,
        o.slug,
        r.recent_requests::text,
        r.recent_errors::text,
        (CASE WHEN r.recent_requests > 0 THEN r.recent_errors::numeric / r.recent_requests ELSE 0 END)::float AS recent_error_rate,
        b.baseline_error_rate::float AS baseline_error_rate,
        b.baseline_stddev::float AS baseline_stddev,
        CASE
          WHEN b.baseline_stddev > 0
          THEN ((r.recent_errors::numeric / NULLIF(r.recent_requests, 0)) - b.baseline_error_rate) / b.baseline_stddev
          ELSE NULL
        END::float AS z
      FROM recent r
      LEFT JOIN baseline b ON b.partner_id = r.partner_id
      LEFT JOIN organizations o ON o.id = r.partner_id
      WHERE r.recent_requests >= 50  -- ignore noisy tiny-volume partners
        AND b.baseline_error_rate IS NOT NULL
    `);

    const fired: AnomalyRow[] = rows.filter((r) => {
      if (r.recent_error_rate <= 0.05) return false; // > 5% absolute
      if (r.z === null) return false;
      return r.z > 3; // > 3σ above 7d baseline
    });

    if (fired.length === 0) {
      this.logger.debug(`Anomaly check: no firings across ${rows.length} candidate partners`);
      return;
    }

    for (const r of fired) {
      const recentReq = Number(r.recent_requests);
      const recentErr = Number(r.recent_errors);
      const recentPct = (r.recent_error_rate * 100).toFixed(2);
      const baselinePct = ((r.baseline_error_rate ?? 0) * 100).toFixed(2);
      const z = r.z?.toFixed(2) ?? '?';
      const partner = r.slug ?? r.partner_id.slice(0, 8);
      const message = `🚨 Partner anomaly: ${partner} error rate ${recentPct}% (${recentErr}/${recentReq}, z=${z}σ; baseline ${baselinePct}%)`;
      this.logger.warn(message);
      if (this.slackWebhook) {
        await this.postSlack(message).catch((err) =>
          this.logger.error(`Slack post failed: ${(err as Error)?.message}`),
        );
      }
    }
  }

  private async postSlack(text: string): Promise<void> {
    if (!this.slackWebhook) return;
    const res = await fetch(this.slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook returned ${res.status}`);
    }
  }
}
