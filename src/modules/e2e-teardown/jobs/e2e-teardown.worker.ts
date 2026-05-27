import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../../queue/queue.service';
import { E2eTeardownService } from '../services/e2e-teardown.service';

export const E2E_TEARDOWN_QUEUE = 'e2e.teardown.tick';

/**
 * Nightly pg-boss worker that sweeps Playwright-seeded `e2e-*` rows.
 *
 * Off by default in production — the `E2E_TEARDOWN_ENABLED` env var has
 * to be explicitly set to `true`. In dev/staging, defaults to a 02:00
 * UTC daily run (override via `E2E_TEARDOWN_CRON`).
 *
 * One handler runs across the fleet because pg-boss elects a single
 * worker per tick — no per-replica fan-out.
 */
@Injectable()
export class E2eTeardownWorker implements OnModuleInit {
  private readonly logger = new Logger(E2eTeardownWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly teardown: E2eTeardownService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = (process.env.E2E_TEARDOWN_ENABLED ?? 'true').toLowerCase() === 'true';
    const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
    if (isProd && process.env.E2E_TEARDOWN_ENABLED !== 'true') {
      this.logger.log(
        'e2e teardown worker skipped — production environment, not explicitly enabled',
      );
      return;
    }
    if (!enabled) {
      this.logger.log('e2e teardown worker disabled via E2E_TEARDOWN_ENABLED=false');
      return;
    }
    await this.queue.registerHandler(
      E2E_TEARDOWN_QUEUE,
      async () => {
        try {
          await this.teardown.sweep();
        } catch (err) {
          this.logger.error(
            `e2e teardown sweep failed: ${(err as Error).message}`,
            (err as Error).stack,
          );
        }
      },
      { teamSize: 1, teamConcurrency: 1 },
    );
    if (process.env.JEST_WORKER_ID !== undefined) return;
    const cron = process.env.E2E_TEARDOWN_CRON || '0 2 * * *';
    try {
      await this.queue.scheduleJob(E2E_TEARDOWN_QUEUE, cron);
      this.logger.log(`e2e teardown cron scheduled: ${cron}`);
    } catch (err) {
      this.logger.warn(
        `Failed to schedule e2e teardown cron: ${(err as Error).message}`,
      );
    }
  }
}
