import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { NotificationService } from '../../notifications/notification.service';
import { QueueService } from '../../queue/queue.service';
import { BrokerPostEntryService } from '../services/broker-post-entry.service';

export const POST_ENTRY_TIMER_QUEUE = 'broker.post_entry.timer';

/**
 * R2-E-03 — post-entry case timer. Each tick:
 *   1. Pulls every post-entry case past its dueAt that isn't resolved.
 *   2. Bumps the escalation level + appends an audit entry.
 *   3. Notifies the assignee (or the broker org) once per escalation
 *      level — handled via NotificationService.
 *
 * The CF28/CF29 deadlines used by the case dueAt are populated when the
 * case is created; this worker is the "what happens when nobody answered"
 * side of that contract.
 */
@Injectable()
export class BrokerPostEntryTimerWorker implements OnModuleInit {
  private readonly logger = new Logger(BrokerPostEntryTimerWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly postEntry: BrokerPostEntryService,
    @Optional()
    private readonly notifications: NotificationService | null,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(
      POST_ENTRY_TIMER_QUEUE,
      async () => {
        const escalated = await this.tick().catch((err) => {
          this.logger.error(
            `Post-entry timer tick failed: ${(err as Error).message}`,
          );
          return 0;
        });
        if (escalated > 0) {
          this.logger.log(`Post-entry timer escalated ${escalated} case(s)`);
        }
      },
      { teamSize: 1, teamConcurrency: 1 },
    );
    if (process.env.JEST_WORKER_ID !== undefined) return;
    const cron = process.env.BROKER_POST_ENTRY_TIMER_CRON || '0 * * * *';
    try {
      await this.queue.scheduleJob(POST_ENTRY_TIMER_QUEUE, cron);
      this.logger.log(`Post-entry timer cron scheduled: ${cron}`);
    } catch (err) {
      this.logger.warn(
        `Failed to schedule post-entry timer cron: ${(err as Error).message}`,
      );
    }
  }

  async tick(): Promise<number> {
    const overdue = await this.postEntry.listOverdueCases(100);
    let count = 0;
    for (const overdueCase of overdue) {
      const escalated = await this.postEntry.escalateOverdueCase(
        overdueCase.id,
      );
      if (!escalated) continue;
      count += 1;
      if (this.notifications && overdueCase.assigneeUserId) {
        await this.notifications
          .send({
            templateKey: 'broker.post_entry.case_overdue',
            subject: `Post-entry case ${overdueCase.caseType} is overdue`,
            bodyText: `Post-entry case ${overdueCase.id} (${overdueCase.caseType}) was due ${overdueCase.dueAt?.toISOString()}.\n\nPlease respond before further escalation.`,
            recipient: {
              userId: overdueCase.assigneeUserId,
              organizationId: overdueCase.brokerOrganizationId,
            },
            context: {
              caseId: overdueCase.id,
              entryId: overdueCase.entryId,
              caseType: overdueCase.caseType,
            },
          })
          .catch((err) =>
            this.logger.warn(
              `Post-entry escalation notification failed: ${(err as Error).message}`,
            ),
          );
      }
    }
    return count;
  }
}
