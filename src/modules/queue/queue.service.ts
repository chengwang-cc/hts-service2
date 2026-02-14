import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PgBoss, type Job, type JobWithMetadata } from 'pg-boss';
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
  private boss: PgBoss;
  private handlers: Map<string, JobHandler> = new Map();
  private isStarted = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
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
    const dbUsername = this.configService.get<string>('DB_USERNAME', 'postgres');
    const dbPassword = this.configService.get<string>('DB_PASSWORD', 'postgres');
    const dbName = this.configService.get<string>('DB', 'hts');

    const databaseUrl = `postgresql://${dbUsername}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;

    this.logger.log(`Initializing pg-boss with database: ${dbName}@${dbHost}:${dbPort}`);

    try {
      this.boss = new PgBoss({
        connectionString: databaseUrl,
        schema: 'pgboss',
        // pg-boss v12 simplified configuration
      });

      // Start pg-boss
      await this.boss.start();
      this.isStarted = true;

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

  /**
   * Gracefully shutdown pg-boss
   */
  private async shutdown(): Promise<void> {
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
    }
  ): Promise<void> {
    this.handlers.set(queueName, handler);
    this.logger.log(`Handler registered for queue: ${queueName}`);

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
    }
  ): Promise<void> {
    if (!this.boss || !this.isStarted) {
      this.logger.warn(`Cannot start queue ${queueName}: pg-boss not started`);
      return;
    }

    try {
      // pg-boss v12 work handler receives Job[] array
      await this.boss.work(
        queueName,
        async (jobs: Job[]) => {
          // Process each job in the batch
          for (const job of jobs) {
            this.logger.log(`Processing job ${job.id} from queue ${queueName}`);

            const startTime = Date.now();

            try {
              await handler(job);

              const duration = Date.now() - startTime;
              this.logger.log(
                `Job ${job.id} completed successfully in ${duration}ms`
              );
            } catch (error) {
              const duration = Date.now() - startTime;
              this.logger.error(
                `Job ${job.id} failed after ${duration}ms: ${error.message}`,
                error.stack
              );
              throw error; // pg-boss will handle retry
            }
          }
        }
      );

      this.logger.log(`Started processing queue: ${queueName}`);
    } catch (error) {
      this.logger.error(
        `Failed to start queue ${queueName}: ${error.message}`,
        error.stack
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
    options?: SendJobOptions
  ): Promise<string> {
    if (!this.boss || !this.isStarted) {
      this.logger.error(
        `Cannot send job to ${queueName}: pg-boss not started`
      );
      throw new Error('Queue service not available');
    }

    try {
      const jobId = await this.boss.send(queueName, data, {
        priority: options?.priority,
        retryLimit: options?.retryLimit,
        retryDelay: options?.retryDelay,
        retryBackoff: options?.retryBackoff,
        expireInSeconds: options?.expireInSeconds,
        singletonKey: options?.singletonKey,
        startAfter: options?.startAfter,
      });

      this.logger.log(
        `Job submitted to ${queueName}: ${jobId}${options?.singletonKey ? ` (singleton: ${options.singletonKey})` : ''}`
      );

      return jobId || '';
    } catch (error) {
      this.logger.error(
        `Failed to send job to ${queueName}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Get job status by ID
   */
  async getJobStatus(queueName: string, jobId: string): Promise<JobWithMetadata<any> | null> {
    if (!this.boss || !this.isStarted) {
      throw new Error('Queue service not available');
    }

    return await this.boss.getJobById(queueName, jobId);
  }

  /**
   * Cancel job by ID
   */
  async cancelJob(queueName: string, jobId: string): Promise<void> {
    if (!this.boss || !this.isStarted) {
      throw new Error('Queue service not available');
    }

    await this.boss.cancel(queueName, jobId);
    this.logger.log(`Job cancelled: ${jobId}`);
  }

  /**
   * Complete job manually (for custom job completion)
   */
  async completeJob(queueName: string, jobId: string, data?: any): Promise<void> {
    if (!this.boss || !this.isStarted) {
      throw new Error('Queue service not available');
    }

    await this.boss.complete(queueName, jobId, data);
    this.logger.log(`Job manually completed: ${jobId}`);
  }

  /**
   * Fail job manually
   */
  async failJob(queueName: string, jobId: string, errorData: any): Promise<void> {
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
    return this.isStarted && this.boss !== null;
  }
}
