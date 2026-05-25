import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../../queue/queue.service';
import { BrokerTasksService } from '../services/broker-tasks.service';

export const BROKER_NOTIFICATIONS_QUEUE = 'broker.notifications.tick';

@Injectable()
export class BrokerNotificationsWorker implements OnModuleInit {
  private readonly logger = new Logger(BrokerNotificationsWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly tasks: BrokerTasksService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(
      BROKER_NOTIFICATIONS_QUEUE,
      async () => {
        await this.tick();
      },
      { teamSize: 1, teamConcurrency: 1 },
    );
    this.logger.log('Broker notifications worker registered');
  }

  /**
   * One tick: find stale tasks and mark them as notified. In production this
   * would also push email/Slack/in-app notifications via an outbound channel.
   */
  async tick(): Promise<void> {
    const stale = await this.tasks.findStaleTasks();
    if (stale.length === 0) return;

    this.logger.log(`Found ${stale.length} stale missing-info tasks`);
    for (const task of stale) {
      try {
        await this.tasks.markNotified(task.id);
        // Future: enqueue email/Slack/in-app via configured channel
      } catch (err) {
        this.logger.warn(
          `Failed to mark task ${task.id} as notified: ${(err as Error).message}`,
        );
      }
    }
  }
}
