import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../../queue/queue.service';
import { MarketplaceRequestsService } from '../services/marketplace-requests.service';

export const MARKETPLACE_QUOTE_EXPIRY_QUEUE = 'marketplace.quote.expiry';

/**
 * Cron worker that flips submitted quotes past their `expiresAt` into the
 * `expired` state. Runs once per minute by default; configurable via
 * MARKETPLACE_QUOTE_EXPIRY_CRON. Safe to skip the schedule call when the
 * queue is disabled (dev w/ QUEUE_DISABLED=true) — the inline-fallback
 * path means tests still work without a running pg-boss.
 */
@Injectable()
export class MarketplaceQuoteExpiryWorker implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceQuoteExpiryWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly requests: MarketplaceRequestsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(
      MARKETPLACE_QUOTE_EXPIRY_QUEUE,
      async () => {
        try {
          const expired = await this.requests.expireDueQuotes();
          if (expired > 0) {
            this.logger.log(`Auto-expired ${expired} marketplace quote(s)`);
          }
        } catch (err) {
          this.logger.error(
            `Quote expiry tick failed: ${(err as Error).message}`,
            (err as Error).stack,
          );
        }
      },
      { teamSize: 1, teamConcurrency: 1 },
    );

    if (process.env.JEST_WORKER_ID !== undefined) return;
    const cron = process.env.MARKETPLACE_QUOTE_EXPIRY_CRON || '* * * * *';
    try {
      await this.queue.scheduleJob(MARKETPLACE_QUOTE_EXPIRY_QUEUE, cron);
      this.logger.log(`Quote expiry cron scheduled: ${cron}`);
    } catch (err) {
      this.logger.warn(
        `Failed to schedule quote expiry cron (queue disabled?): ${
          (err as Error).message
        }`,
      );
    }
  }
}
