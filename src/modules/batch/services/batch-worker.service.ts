import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SearchService } from '@hts/lookup';
import { SmartClassifyService } from '../../lookup/services/smart-classify.service';
import { QueueService } from '../../queue/queue.service';
import { BatchJobService, BATCH_COORDINATOR_QUEUE, BATCH_ITEM_QUEUE } from './batch-job.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BatchJobEntity } from '../entities/batch-job.entity';

@Injectable()
export class BatchWorkerService implements OnModuleInit {
  private readonly logger = new Logger(BatchWorkerService.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly batchJobService: BatchJobService,
    private readonly searchService: SearchService,
    private readonly smartClassifyService: SmartClassifyService,
    @InjectRepository(BatchJobEntity)
    private readonly jobRepo: Repository<BatchJobEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Coordinator: fans out per-item jobs (concurrency 1, single worker)
    await this.queueService.registerHandler(
      BATCH_COORDINATOR_QUEUE,
      async (job) => {
        const { jobId } = job.data as { jobId: string; resume?: boolean };
        await this.batchJobService.startJobExecution(jobId);
      },
      { teamSize: 1, teamConcurrency: 1 },
    );

    // Item worker: 10 items in parallel
    await this.queueService.registerHandler(
      BATCH_ITEM_QUEUE,
      async (job) => {
        const { jobId, itemId } = job.data as { jobId: string; itemId: string };
        await this.processItem(jobId, itemId);
      },
      { teamSize: 2, teamConcurrency: 5 },
    );

    this.logger.log('Batch queue handlers registered');
  }

  private async processItem(jobId: string, itemId: string): Promise<void> {
    // Check job status before processing (supports pause/cancel)
    const dbJob = await this.jobRepo.findOne({
      where: { id: jobId },
      select: ['status', 'method'],
    });

    if (!dbJob || dbJob.status === 'cancelled') {
      await this.batchJobService.markItemSkipped(itemId);
      return;
    }

    if (dbJob.status === 'paused') {
      // Reset item back to pending — re-queued by coordinator on resume
      await this.batchJobService.requeueItem(itemId);
      return;
    }

    const item = await this.batchJobService.getItem(itemId);
    if (!item || item.status !== 'pending') return;

    const start = Date.now();

    try {
      if (dbJob.method === 'deep_search') {
        await this.processWithDeepSearch(jobId, itemId, item.query, start);
      } else {
        await this.processWithAutocomplete(jobId, itemId, item.query, start);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Item ${itemId}] Failed: ${msg}`);
      await this.batchJobService.recordItemResult(jobId, itemId, {
        errorMessage: msg,
        processingMs: Date.now() - start,
      });
    }
  }

  private async processWithDeepSearch(
    jobId: string,
    itemId: string,
    query: string,
    start: number,
  ): Promise<void> {
    const result = await this.smartClassifyService.classify(query);
    const top = result.results[0] as any;

    await this.batchJobService.recordItemResult(jobId, itemId, {
      htsNumber: top?.htsNumber ?? undefined,
      description: top?.description ?? undefined,
      fullDescription: top?.fullDescription ?? undefined,
      confidence: top?.score ?? top?.similarity ?? undefined,
      topResults: result.results,
      phases: result.phases as unknown as Record<string, unknown>,
      processingMs: Date.now() - start,
    });
  }

  private async processWithAutocomplete(
    jobId: string,
    itemId: string,
    query: string,
    start: number,
  ): Promise<void> {
    const results = await this.searchService.autocomplete(query, 5);
    const top = results[0] as any;

    await this.batchJobService.recordItemResult(jobId, itemId, {
      htsNumber: top?.htsNumber ?? undefined,
      description: top?.description ?? undefined,
      fullDescription: top?.fullDescription ?? undefined,
      confidence: top?.score ?? undefined,
      topResults: results,
      processingMs: Date.now() - start,
    });
  }
}
