import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QueueService } from '../../queue/queue.service';

/**
 * Closed-hour rollup of api_usage_metrics into partner_usage_hourly.
 *
 * Scheduled every 5 minutes via pg-boss. Each run:
 *   1. Picks the most recent closed hour we haven't yet rolled up
 *   2. INSERT ... ON CONFLICT DO UPDATE — idempotent by the unique key
 *      (partner_id, bucket_hour, partner_user_id, endpoint, method)
 *
 * The rollup query is a single statement so a partial run doesn't leave
 * the table in a weird state — either the hour is fully written or not.
 */
export const PARTNER_USAGE_ROLLUP_QUEUE = 'partner-usage-rollup';

@Injectable()
export class PartnerUsageRollupWorker implements OnModuleInit {
  private readonly logger = new Logger(PartnerUsageRollupWorker.name);

  constructor(
    private readonly queue: QueueService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(PARTNER_USAGE_ROLLUP_QUEUE, async () => {
      await this.runRollup();
    });
    // singletonKey prevents pg-boss from queuing a second job when the
    // previous run is still in flight — if a rollup occasionally takes
    // longer than 5 min, the next tick is dropped rather than racing on the
    // same buckets.
    await this.queue.scheduleJob(PARTNER_USAGE_ROLLUP_QUEUE, '*/5 * * * *', {}, {
      singletonKey: PARTNER_USAGE_ROLLUP_QUEUE,
    });
    this.logger.log(`Rollup worker registered (cron: */5 * * * *, singleton)`);
  }

  /**
   * Roll up the most recent CLOSED hour we haven't fully covered. "Closed"
   * means timestamp < date_trunc('hour', now()) — we never touch the
   * currently-accumulating hour because more rows will arrive.
   */
  async runRollup(): Promise<void> {
    // Find the latest already-rolled-up hour, default to 24h ago on first run.
    const latestRes: Array<{ latest_hour: Date | null }> = await this.ds.query(
      `SELECT MAX(bucket_hour) AS latest_hour FROM partner_usage_hourly`,
    );
    const latestHour: Date | null = latestRes[0]?.latest_hour ?? null;

    // Start from the hour AFTER the latest, end at the previous hour from now.
    const startSql = latestHour
      ? `'${latestHour.toISOString()}'::timestamp + interval '1 hour'`
      : `date_trunc('hour', now() - interval '24 hours')`;
    const endSql = `date_trunc('hour', now())`;

    const inserted: Array<{ inserted: string }> = await this.ds.query(`
      WITH rolled AS (
        INSERT INTO partner_usage_hourly (
          bucket_hour, partner_id, partner_user_id, endpoint, method,
          requests, status2xx, status4xx, status5xx, p95_latency_ms,
          total_response_time_ms, updated_at
        )
        SELECT
          date_trunc('hour', m.timestamp) AS bucket_hour,
          m.partner_id,
          m.partner_user_id,
          m.endpoint,
          m.method,
          COUNT(*) AS requests,
          COUNT(*) FILTER (WHERE m.status_code >= 200 AND m.status_code < 300) AS status2xx,
          COUNT(*) FILTER (WHERE m.status_code >= 400 AND m.status_code < 500) AS status4xx,
          COUNT(*) FILTER (WHERE m.status_code >= 500) AS status5xx,
          percentile_disc(0.95) WITHIN GROUP (ORDER BY m.response_time_ms)::int AS p95_latency_ms,
          COALESCE(SUM(m.response_time_ms), 0)::bigint AS total_response_time_ms,
          now() AS updated_at
        FROM api_usage_metrics m
        WHERE m.partner_id IS NOT NULL
          AND m.timestamp >= ${startSql}
          AND m.timestamp <  ${endSql}
        GROUP BY date_trunc('hour', m.timestamp), m.partner_id, m.partner_user_id, m.endpoint, m.method
        ON CONFLICT (partner_id, bucket_hour, partner_user_id, endpoint, method)
        DO UPDATE SET
          requests = EXCLUDED.requests,
          status2xx = EXCLUDED.status2xx,
          status4xx = EXCLUDED.status4xx,
          status5xx = EXCLUDED.status5xx,
          p95_latency_ms = EXCLUDED.p95_latency_ms,
          total_response_time_ms = EXCLUDED.total_response_time_ms,
          updated_at = now()
        RETURNING 1
      )
      SELECT COUNT(*)::text AS inserted FROM rolled
    `);

    const n = Number(inserted[0]?.inserted ?? 0);
    if (n > 0) {
      this.logger.log(`Rolled up ${n} partner/user/endpoint/method buckets`);
    }
  }
}
