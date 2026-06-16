import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QueueService } from '../../queue/queue.service';
import { CostAlertService } from '../../billing/services/cost-alert.service';

/**
 * Monthly rollup of api_usage_metrics into partner_usage_monthly.
 *
 * Unlike the hourly rollup, this one re-rolls the CURRENT calendar month on
 * every tick (hourly). EntitlementGuard reads from this table for quota
 * enforcement; it needs the in-progress month to be fresh enough that a
 * partner doesn't blow past their plan limits before the next rollup.
 *
 * Cost: O(rows-in-current-month) per partner per hour. Acceptable at our
 * scale; if it becomes a problem, switch to incremental upsert keyed on the
 * latest seen metric id.
 *
 * Idempotent by the unique (partner_id, bucket_month, endpoint, method) key.
 */
export const PARTNER_USAGE_MONTHLY_ROLLUP_QUEUE = 'partner-usage-monthly-rollup';

@Injectable()
export class PartnerUsageMonthlyRollupWorker implements OnModuleInit {
  private readonly logger = new Logger(PartnerUsageMonthlyRollupWorker.name);

  constructor(
    private readonly queue: QueueService,
    @InjectDataSource() private readonly ds: DataSource,
    // Optional so a future test bootstrap can omit the BillingModule
    // without breaking the rollup itself. The alert step is wrapped in
    // an env-flag check and a defensive null-guard for the same reason.
    @Optional() private readonly costAlerts?: CostAlertService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(PARTNER_USAGE_MONTHLY_ROLLUP_QUEUE, async () => {
      await this.runRollup();
    });
    await this.queue.scheduleJob(
      PARTNER_USAGE_MONTHLY_ROLLUP_QUEUE,
      '0 * * * *',
      {},
      { singletonKey: PARTNER_USAGE_MONTHLY_ROLLUP_QUEUE },
    );
    this.logger.log(`Monthly rollup worker registered (cron: 0 * * * *, singleton)`);
  }

  /**
   * Roll up the current calendar month. The DO UPDATE clause overwrites the
   * previous snapshot for the same (partner, month, endpoint, method) tuple,
   * which is what we want — each tick produces a fresher snapshot.
   */
  async runRollup(): Promise<void> {
    const inserted: Array<{ inserted: string }> = await this.ds.query(`
      WITH rolled AS (
        INSERT INTO partner_usage_monthly (
          bucket_month, partner_id, endpoint, method,
          requests, status2xx, status4xx, status5xx,
          cost_usd, llm_input_tokens, llm_output_tokens, llm_cached_tokens, updated_at
        )
        SELECT
          date_trunc('month', m.timestamp)::date AS bucket_month,
          m.partner_id,
          m.endpoint,
          m.method,
          COUNT(*) AS requests,
          COUNT(*) FILTER (WHERE m.status_code >= 200 AND m.status_code < 300) AS status2xx,
          COUNT(*) FILTER (WHERE m.status_code >= 400 AND m.status_code < 500) AS status4xx,
          COUNT(*) FILTER (WHERE m.status_code >= 500) AS status5xx,
          COALESCE(SUM(m.cost_usd), 0) AS cost_usd,
          COALESCE(SUM(m.llm_input_tokens), 0)::bigint AS llm_input_tokens,
          COALESCE(SUM(m.llm_output_tokens), 0)::bigint AS llm_output_tokens,
          COALESCE(SUM(m.llm_cached_tokens), 0)::bigint AS llm_cached_tokens,
          now() AS updated_at
        FROM api_usage_metrics m
        WHERE m.partner_id IS NOT NULL
          AND m.timestamp >= date_trunc('month', now())
          AND m.timestamp <  date_trunc('month', now()) + interval '1 month'
        GROUP BY date_trunc('month', m.timestamp), m.partner_id, m.endpoint, m.method
        ON CONFLICT (partner_id, bucket_month, endpoint, method)
        DO UPDATE SET
          requests = EXCLUDED.requests,
          status2xx = EXCLUDED.status2xx,
          status4xx = EXCLUDED.status4xx,
          status5xx = EXCLUDED.status5xx,
          cost_usd = EXCLUDED.cost_usd,
          llm_input_tokens = EXCLUDED.llm_input_tokens,
          llm_output_tokens = EXCLUDED.llm_output_tokens,
          llm_cached_tokens = EXCLUDED.llm_cached_tokens,
          updated_at = now()
        RETURNING 1
      )
      SELECT COUNT(*)::text AS inserted FROM rolled
    `);

    const n = Number(inserted[0]?.inserted ?? 0);
    if (n > 0) {
      this.logger.log(`Monthly rollup updated ${n} (partner, endpoint, method) buckets`);
    }

    // Phase 4b: cost-threshold alerts.
    // Runs in the SAME worker because monthly cost is freshly committed
    // and we can deliver alerts within one hour of the actual crossing.
    // Gated behind COST_ALERTS_ENABLED so the entire feature can be
    // disabled by env-flag without a code revert — see execution-plan
    // §7b.9. Defaults to disabled until DB migration is applied in prod.
    if (this.costAlerts && process.env.COST_ALERTS_ENABLED === 'true') {
      try {
        const fired = await this.costAlerts.detectAndFireCrossings();
        if (fired.length > 0) {
          this.logger.log(
            `Cost-threshold alerts fired: ${fired.length} ` +
              `(webhooks queued: ${fired.filter((f) => f.webhookQueued).length})`,
          );
        }
      } catch (err) {
        // Alert delivery must NOT break the rollup itself — the rollup
        // is what feeds quota enforcement, and missed alerts are
        // recoverable on the next hourly tick.
        this.logger.warn(
          `Cost-alert detection failed (rollup continues): ${(err as Error)?.message}`,
        );
      }
    }
  }
}
