import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../../../queue/queue.service';
import { FinancialReportsService } from '../services/financial-reports.service';

/**
 * Nightly refresh of the financial-reports materialized views.
 *
 * Phase 9, PR F9.1.
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §13.2
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §10.1
 *
 * Schedule: 03:00 UTC daily — one hour after the reconciliation cron
 * (02:00 UTC) so reports never reflect un-reconciled data.
 *
 * Gating
 * ------
 * FINANCIAL_REPORTS_ENABLED=true to deploy dark. The schedule
 * registration is still wired so flipping the flag at runtime takes
 * effect on the next 03:00 boundary (no service restart needed).
 *
 * Concurrency
 * -----------
 * pg-boss singletonKey ensures only one run at a time. The underlying
 * REFRESH MATERIALIZED VIEW CONCURRENTLY is itself concurrent-safe
 * across the views (each takes its own write lock), but the worker-
 * level singleton keeps cron+manual triggers from overlapping.
 */
export const FINANCIAL_REPORTS_REFRESH_QUEUE = 'financial-reports-refresh';

@Injectable()
export class FinancialReportsRefreshWorker implements OnModuleInit {
  private readonly logger = new Logger(FinancialReportsRefreshWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly reports: FinancialReportsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.FINANCIAL_REPORTS_ENABLED !== 'true') {
      this.logger.log(
        'Financial reports refresh cron is disabled (set FINANCIAL_REPORTS_ENABLED=true to enable).',
      );
      return;
    }

    await this.queue.registerHandler(
      FINANCIAL_REPORTS_REFRESH_QUEUE,
      async () => {
        const result = await this.reports.refreshAll();
        if (result.failed.length > 0) {
          // Logged loudly; doesn't throw — partial refresh is better
          // than no refresh, and the next cron tick gets another shot.
          this.logger.warn(
            `[reports] partial failure: ${result.failed
              .map((f) => `${f.view}=${f.error}`)
              .join('; ')}`,
          );
        }
      },
    );

    await this.queue.scheduleJob(
      FINANCIAL_REPORTS_REFRESH_QUEUE,
      '0 3 * * *', // 03:00 UTC daily
      {},
      { singletonKey: FINANCIAL_REPORTS_REFRESH_QUEUE },
    );

    this.logger.log(
      `Financial reports refresh worker registered (cron: 0 3 * * *, singleton).`,
    );
  }
}
