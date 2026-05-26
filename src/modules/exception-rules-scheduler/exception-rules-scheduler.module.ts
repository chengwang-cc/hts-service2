import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { QueueService } from '../queue/queue.service';
import { KnowledgebaseCardsModule } from '../knowledgebase-cards/knowledgebase-cards.module';
import { SourceMonitorJob } from '../knowledgebase-cards/jobs/source-monitor.job';
import { DailyDigestJob } from '../knowledgebase-cards/jobs/daily-digest.job';
import {
  KNOWLEDGEBASE_DAILY_DIGEST_QUEUE,
  KNOWLEDGEBASE_SOURCE_MONITOR_QUEUE,
} from '../knowledgebase-cards/jobs/knowledge-source-queues';

/**
 * ExceptionRulesSchedulerModule.
 *
 * Registers pg-boss cron schedules for the Phase 8 source-monitor and
 * daily-digest jobs. Gated by env so dev/test runs don't unintentionally
 * start polling external sources:
 *
 *   KNOWLEDGE_SOURCE_MONITOR_ENABLED=true   register 0 ⏰/6h cron
 *   ALERT_DAILY_DIGEST_ENABLED=true         register 0 8 * * * cron
 *
 * The schedules use `QueueService.scheduleJob()` (idempotent upsert) so
 * re-deploys are safe. Job handlers are registered unconditionally so
 * the queue can run on-demand via the admin endpoints even when crons
 * are dormant.
 */
@Module({
  imports: [QueueModule, KnowledgebaseCardsModule],
})
export class ExceptionRulesSchedulerModule implements OnModuleInit {
  private readonly logger = new Logger(ExceptionRulesSchedulerModule.name);
  static readonly SOURCE_MONITOR_QUEUE = KNOWLEDGEBASE_SOURCE_MONITOR_QUEUE;
  static readonly DAILY_DIGEST_QUEUE = KNOWLEDGEBASE_DAILY_DIGEST_QUEUE;

  constructor(
    private readonly queue: QueueService,
    private readonly sourceMonitor: SourceMonitorJob,
    private readonly dailyDigest: DailyDigestJob,
  ) {}

  async onModuleInit(): Promise<void> {
    // Handlers — always registered. The job is callable on-demand via
    // QueueService.sendJob() even when the cron isn't scheduled.
    try {
      await this.queue.registerHandler(
        ExceptionRulesSchedulerModule.SOURCE_MONITOR_QUEUE,
        async (job) => {
          await this.sourceMonitor.runFromQueue({
            ...(job.data as Record<string, unknown> | undefined),
            jobId: job.id,
          });
        },
      );
      await this.queue.registerHandler(
        ExceptionRulesSchedulerModule.DAILY_DIGEST_QUEUE,
        async () => {
          await this.dailyDigest.runOnce();
        },
      );
    } catch (e: any) {
      this.logger.warn(`registerHandler failed: ${e?.message ?? e}`);
    }

    // Schedules — env-gated. Default OFF.
    if (process.env.KNOWLEDGE_SOURCE_MONITOR_ENABLED === 'true') {
      try {
        await this.queue.scheduleJob(
          ExceptionRulesSchedulerModule.SOURCE_MONITOR_QUEUE,
          '0 */6 * * *',
        );
        this.logger.log('source-monitor cron registered (every 6h)');
      } catch (e: any) {
        this.logger.warn(`source-monitor scheduleJob failed: ${e?.message ?? e}`);
      }
    } else {
      this.logger.debug('KNOWLEDGE_SOURCE_MONITOR_ENABLED!=true — source-monitor cron NOT scheduled');
    }

    if (process.env.ALERT_DAILY_DIGEST_ENABLED === 'true') {
      try {
        await this.queue.scheduleJob(
          ExceptionRulesSchedulerModule.DAILY_DIGEST_QUEUE,
          '0 8 * * *',
        );
        this.logger.log('daily-digest cron registered (daily at 08:00)');
      } catch (e: any) {
        this.logger.warn(`daily-digest scheduleJob failed: ${e?.message ?? e}`);
      }
    } else {
      this.logger.debug('ALERT_DAILY_DIGEST_ENABLED!=true — daily-digest cron NOT scheduled');
    }
  }
}
