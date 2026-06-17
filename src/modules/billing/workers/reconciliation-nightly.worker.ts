import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../../queue/queue.service';
import { ReconciliationService } from '../services/reconciliation.service';

/**
 * Nightly cron at 02:00 UTC: reconcile Stripe `balance_transactions`
 * for the previous calendar day against `credit_ledger`. Writes a
 * `reconciliation_runs` row + per-mismatch entries.
 *
 * Phase 6 of the financial management rollout (PR F6.1).
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §10
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §7.1
 *
 * Why 02:00 UTC
 * -------------
 * Stripe's accounting cutoff is midnight UTC. Running at 02:00 gives
 * Stripe two hours to settle any near-boundary events. Running earlier
 * risks racing the settlement and surfacing transient mismatches.
 *
 * Gating
 * ------
 * RECONCILIATION_CRON_ENABLED=true to deploy dark. The schedule
 * registration is still wired so flipping the flag at runtime takes
 * effect on the next 02:00 boundary (no service restart needed).
 *
 * Concurrency
 * -----------
 * pg-boss singletonKey ensures only one run at a time; the
 * `reconciliation_runs.as_of_date` UNIQUE constraint is the secondary
 * defense (a manual re-run for the same date UPSERTs).
 */
export const RECONCILIATION_NIGHTLY_QUEUE = 'reconciliation-nightly';

@Injectable()
export class ReconciliationNightlyWorker implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationNightlyWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.RECONCILIATION_CRON_ENABLED !== 'true') {
      this.logger.log(
        'Reconciliation nightly cron is disabled (set RECONCILIATION_CRON_ENABLED=true to enable).',
      );
      return;
    }

    await this.queue.registerHandler(
      RECONCILIATION_NIGHTLY_QUEUE,
      async () => {
        // pg-boss invokes the handler at scheduled times. `now` is the
        // moment of execution; ReconciliationService.windowFor() walks
        // back one calendar day in UTC.
        await this.reconciliation.run(new Date());
      },
    );

    await this.queue.scheduleJob(
      RECONCILIATION_NIGHTLY_QUEUE,
      '0 2 * * *', // 02:00 UTC daily
      {},
      { singletonKey: RECONCILIATION_NIGHTLY_QUEUE },
    );

    this.logger.log(
      `Reconciliation nightly worker registered (cron: 0 2 * * *, singleton).`,
    );
  }
}
