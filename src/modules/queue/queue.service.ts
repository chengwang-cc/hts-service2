import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Job, JobWithMetadata } from 'pg-boss';
import { ConfigService } from '@nestjs/config';

export interface SendJobOptions {
  priority?: number;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
  singletonKey?: string;
  startAfter?: number | string | Date;
}

export interface ScheduleJobOptions {
  tz?: string;
}

export interface JobHandler {
  (job: Job): Promise<void>;
}

/**
 * Queue Service - Real pg-boss v12 Implementation
 * Provides reliable, persistent job queue with crash recovery
 * and cluster-safe job processing
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private boss: any;
  private handlers: Map<string, JobHandler> = new Map();
  private isStarted = false;
  private readonly queueDisabled =
    process.env.JEST_WORKER_ID !== undefined ||
    (process.env.QUEUE_DISABLED ?? 'false') === 'true';
  private readonly inlineFallbackEnabled =
    (process.env.QUEUE_INLINE_FALLBACK ?? 'true') === 'true';

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    if (this.queueDisabled) {
      this.isStarted = true;
      this.logger.warn(
        'QueueService disabled for test/runtime override (jobs will be no-op)',
      );
      return;
    }
    await this.initialize();
  }

  async onModuleDestroy() {
    await this.shutdown();
  }

  /**
   * Initialize pg-boss with database connection
   */
  private async initialize(): Promise<void> {
    // Construct database URL from existing environment variables
    const dbHost = this.configService.get<string>('DB_HOST', 'localhost');
    const dbPort = this.configService.get<number>('DB_PORT', 5432);
    const dbUsername = this.configService.get<string>(
      'DB_USERNAME',
      'postgres',
    );
    const dbPassword = this.configService.get<string>(
      'DB_PASSWORD',
      'postgres',
    );
    const dbName =
      this.configService.get<string>('DB_DATABASE') ||
      this.configService.get<string>('DB') ||
      'hts';

    const databaseUrl = `postgresql://${dbUsername}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;

    this.logger.log(
      `Initializing pg-boss with database: ${dbName}@${dbHost}:${dbPort}`,
    );

    try {
      const PgBoss = await this.loadPgBoss();
      this.boss = new PgBoss({
        connectionString: databaseUrl,
        schema: 'pgboss',
        // pg-boss v12 simplified configuration
      });

      // Start pg-boss
      await this.boss.start();
      this.isStarted = true;

      // Add error handler to prevent unhandled errors from crashing the app
      this.boss.on('error', (error) => {
        // Log queue-not-exist errors as warnings (queues will be created on first job submission)
        if (
          error &&
          error.message &&
          error.message.includes('does not exist')
        ) {
          // this.logger.warn(`Queue will be created on first job submission: ${error.message}`);
        } else {
          this.logger.error('pg-boss error:', error);
        }
      });

      this.logger.log('pg-boss started successfully');

      // Register all handlers that were registered before start
      for (const [queueName, handler] of this.handlers.entries()) {
        await this.startQueue(queueName, handler);
      }

      this.logger.log(`Registered ${this.handlers.size} job handlers`);
    } catch (error) {
      this.logger.error('Failed to start pg-boss:', error.message, error.stack);
      throw error;
    }
  }

  private async loadPgBoss(): Promise<any> {
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<any>;

    const module = await dynamicImport('pg-boss');
    return module.PgBoss || module.default;
  }

  /**
   * Gracefully shutdown pg-boss
   */
  private async shutdown(): Promise<void> {
    if (this.queueDisabled) {
      return;
    }

    if (!this.boss || !this.isStarted) {
      return;
    }

    try {
      this.logger.log('Shutting down pg-boss gracefully...');
      await this.boss.stop({ graceful: true, timeout: 30000 });
      this.isStarted = false;
      this.logger.log('pg-boss stopped successfully');
    } catch (error) {
      this.logger.error('Error stopping pg-boss:', error.message);
    }
  }

  /**
   * Register handler for job type
   * Can be called before or after pg-boss starts
   */
  async registerHandler(
    queueName: string,
    handler: JobHandler,
    options?: {
      teamSize?: number;
      teamConcurrency?: number;
    },
  ): Promise<void> {
    this.handlers.set(queueName, handler);
    this.logger.log(`Handler registered for queue: ${queueName}`);

    if (this.queueDisabled) {
      return;
    }

    // If pg-boss already started, start processing this queue immediately
    if (this.isStarted) {
      await this.startQueue(queueName, handler, options);
    }
  }

  /**
   * Start processing a specific queue
   */
  private async startQueue(
    queueName: string,
    handler: JobHandler,
    options?: {
      teamSize?: number;
      teamConcurrency?: number;
    },
  ): Promise<void> {
    if (!this.boss || !this.isStarted) {
      this.logger.warn(`Cannot start queue ${queueName}: pg-boss not started`);
      return;
    }

    try {
      // pg-boss v12 work handler receives Job[] array
      await this.boss.work(queueName, async (jobs: Job[]) => {
        // Process each job in the batch
        for (const job of jobs) {
          this.logger.log(`Processing job ${job.id} from queue ${queueName}`);

          const startTime = Date.now();

          try {
            await handler(job);

            const duration = Date.now() - startTime;
            this.logger.log(
              `Job ${job.id} completed successfully in ${duration}ms`,
            );
          } catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error(
              `Job ${job.id} failed after ${duration}ms: ${error.message}`,
              error.stack,
            );
            throw error; // pg-boss will handle retry
          }
        }
      });

      this.logger.log(`Started processing queue: ${queueName}`);
    } catch (error) {
      this.logger.error(
        `Failed to start queue ${queueName}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Send job to queue (persisted to database)
   * Returns job ID for tracking
   */
  async sendJob(
    queueName: string,
    data: Record<string, any>,
    options?: SendJobOptions,
  ): Promise<string> {
    const inlineJobId = `job-inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (this.queueDisabled) {
      this.triggerInlineFallback(
        queueName,
        inlineJobId,
        data,
        'queue_disabled',
      );
      return inlineJobId;
    }

    if (!this.boss || !this.isStarted) {
      this.logger.error(`Cannot send job to ${queueName}: pg-boss not started`);
      if (this.inlineFallbackEnabled) {
        this.triggerInlineFallback(
          queueName,
          inlineJobId,
          data,
          'queue_not_started',
        );
        return inlineJobId;
      }
      throw new Error('Queue service not available');
    }

    try {
      // Ensure queue exists before sending (pg-boss v12 requirement)
      await this.boss.createQueue(queueName);

      // Filter out undefined values to avoid pg-boss validation errors
      const jobOptions: Record<string, any> = {};
      if (options?.priority !== undefined)
        jobOptions.priority = options.priority;
      if (options?.retryLimit !== undefined)
        jobOptions.retryLimit = options.retryLimit;
      if (options?.retryDelay !== undefined)
        jobOptions.retryDelay = options.retryDelay;
      if (options?.retryBackoff !== undefined)
        jobOptions.retryBackoff = options.retryBackoff;
      if (options?.expireInSeconds !== undefined)
        jobOptions.expireInSeconds = options.expireInSeconds;
      if (options?.singletonKey !== undefined)
        jobOptions.singletonKey = options.singletonKey;
      if (options?.startAfter !== undefined)
        jobOptions.startAfter = options.startAfter;

      const jobId = await this.boss.send(queueName, data, jobOptions);

      this.logger.log(
        `Job submitted to ${queueName}: ${jobId}${options?.singletonKey ? ` (singleton: ${options.singletonKey})` : ''}`,
      );

      return jobId || '';
    } catch (error) {
      this.logger.error(
        `Failed to send job to ${queueName}: ${error.message}`,
        error.stack,
      );
      if (this.inlineFallbackEnabled) {
        this.triggerInlineFallback(queueName, inlineJobId, data, 'send_failed');
        return inlineJobId;
      }
      throw error;
    }
  }

  /**
   * Schedule (or upsert) a recurring cron job for a queue.
   */
  async scheduleJob(
    queueName: string,
    cronExpression: string,
    data: Record<string, any> = {},
    options?: ScheduleJobOptions,
  ): Promise<void> {
    if (this.queueDisabled) {
      this.logger.warn(
        `Schedule skipped for ${queueName}: queue is disabled in this environment`,
      );
      return;
    }

    if (!this.boss || !this.isStarted) {
      throw new Error('Queue service not available');
    }

    await this.boss.createQueue(queueName);
    await this.boss.schedule(queueName, cronExpression, data, {
      tz: options?.tz,
    });

    this.logger.log(
      `Recurring schedule upserted for ${queueName}: cron="${cronExpression}"${options?.tz ? ` tz=${options.tz}` : ''}`,
    );
  }

  /**
   * Remove a recurring cron schedule for a queue.
   */
  async unscheduleJob(queueName: string): Promise<void> {
    if (this.queueDisabled) {
      return;
    }

    if (!this.boss || !this.isStarted) {
      throw new Error('Queue service not available');
    }

    await this.boss.unschedule(queueName);
    this.logger.log(`Recurring schedule removed for ${queueName}`);
  }

  private triggerInlineFallback(
    queueName: string,
    jobId: string,
    data: Record<string, any>,
    reason: 'queue_disabled' | 'queue_not_started' | 'send_failed',
  ): void {
    const handler = this.handlers.get(queueName);
    if (!handler) {
      this.logger.warn(
        `Inline fallback skipped for queue ${queueName}: no handler registered (${reason})`,
      );
      return;
    }

    this.logger.warn(
      `Queue fallback active for ${queueName} (${reason}); executing job inline with id=${jobId}`,
    );

    Promise.resolve()
      .then(async () => {
        const fallbackJob = {
          id: jobId,
          name: queueName,
          data,
        } as Job;
        await handler(fallbackJob);
        this.logger.log(
          `Inline fallback job completed for ${queueName}: ${jobId}`,
        );
      })
      .catch((error) => {
        this.logger.error(
          `Inline fallback job failed for ${queueName}: ${error?.message || error}`,
          error?.stack,
        );
      });
  }

  /**
   * Get job status by ID
   */
  async getJobStatus(
    queueName: string,
    jobId: string,
  ): Promise<JobWithMetadata<any> | null> {
    if (this.queueDisabled) {
      return null;
    }

    if (!this.boss || !this.isStarted) {
      throw new Error('Queue service not available');
    }

    return await this.boss.getJobById(queueName, jobId);
  }

  /**
   * Cancel job by ID
   */
  async cancelJob(queueName: string, jobId: string): Promise<void> {
    if (this.queueDisabled) {
      return;
    }

    if (!this.boss || !this.isStarted) {
      throw new Error('Queue service not available');
    }

    await this.boss.cancel(queueName, jobId);
    this.logger.log(`Job cancelled: ${jobId}`);
  }

  /**
   * Complete job manually (for custom job completion)
   */
  async completeJob(
    queueName: string,
    jobId: string,
    data?: any,
  ): Promise<void> {
    if (this.queueDisabled) {
      return;
    }

    if (!this.boss || !this.isStarted) {
      throw new Error('Queue service not available');
    }

    await this.boss.complete(queueName, jobId, data);
    this.logger.log(`Job manually completed: ${jobId}`);
  }

  /**
   * Fail job manually
   */
  async failJob(
    queueName: string,
    jobId: string,
    errorData: any,
  ): Promise<void> {
    if (this.queueDisabled) {
      return;
    }

    if (!this.boss || !this.isStarted) {
      throw new Error('Queue service not available');
    }

    await this.boss.fail(queueName, jobId, errorData);
    this.logger.log(`Job manually failed: ${jobId}`);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName?: string): Promise<any> {
    if (this.queueDisabled) {
      return {};
    }

    if (!this.boss || !this.isStarted) {
      throw new Error('Queue service not available');
    }

    if (queueName) {
      return await this.boss.getQueue(queueName);
    }

    // Get stats for all registered queues
    const queueNames = Array.from(this.handlers.keys());
    return await this.boss.getQueues(queueNames);
  }

  /**
   * Check if queue service is ready
   */
  isReady(): boolean {
    if (this.queueDisabled) {
      return true;
    }
    return this.isStarted && this.boss !== null;
  }
}
