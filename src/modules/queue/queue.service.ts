/**
 * Queue Service
 * Wraps pg-boss for job queue operations
 */

import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import PgBoss from 'pg-boss';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);

  constructor(@Inject('PG_BOSS') private boss: PgBoss) {}

  /**
   * Send a job to the queue
   */
  async sendJob(queueName: string, data: any, options?: PgBoss.SendOptions): Promise<string | null> {
    try {
      const jobId = await this.boss.send(queueName, data, options);
      this.logger.log(`Job sent to queue "${queueName}": ${jobId}`);
      return jobId;
    } catch (error) {
      this.logger.error(`Failed to send job to queue "${queueName}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Register a job handler
   */
  async registerHandler(queueName: string, handler: (job: PgBoss.Job) => Promise<void>, options?: PgBoss.WorkOptions): Promise<string> {
    try {
      const workId = await this.boss.work(queueName, options || {}, handler);
      this.logger.log(`Handler registered for queue "${queueName}"`);
      return workId;
    } catch (error) {
      this.logger.error(`Failed to register handler for queue "${queueName}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<PgBoss.JobWithMetadata | null> {
    return this.boss.getJobById(jobId);
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<void> {
    await this.boss.cancel(jobId);
    this.logger.log(`Job cancelled: ${jobId}`);
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy() {
    this.logger.log('Stopping pg-boss...');
    await this.boss.stop();
  }
}
