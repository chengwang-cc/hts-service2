import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { BatchJobEntity, BatchJobMethod, BatchJobStatus } from '../entities/batch-job.entity';
import { BatchJobItemEntity } from '../entities/batch-job-item.entity';
import { QueueService } from '../../queue/queue.service';
import { BatchItemDto } from '../dto/create-batch-job.dto';

export const BATCH_COORDINATOR_QUEUE = 'batch-job-coordinator';
export const BATCH_ITEM_QUEUE = 'batch-job-item';

const GUEST_EXPIRY_DAYS = 7;
const USER_EXPIRY_DAYS = 30;
const GUEST_MAX_ITEMS = 100;
const USER_MAX_ITEMS = 500;

export interface OwnerContext {
  ownerKey: string;
  ownerType: 'guest' | 'user';
  organizationId?: string;
  userId?: string;
  isGuest: boolean;
  /** Raw guest token (only set for guest owners) — must be returned to client */
  guestToken?: string;
}

@Injectable()
export class BatchJobService {
  private readonly logger = new Logger(BatchJobService.name);

  constructor(
    @InjectRepository(BatchJobEntity)
    private readonly jobRepo: Repository<BatchJobEntity>,
    @InjectRepository(BatchJobItemEntity)
    private readonly itemRepo: Repository<BatchJobItemEntity>,
    private readonly queueService: QueueService,
  ) {}

  // ── Owner key helpers ──────────────────────────────────────────────────────

  static hashOwnerKey(type: 'guest' | 'user', id: string): string {
    return createHash('sha256').update(`${type}:${id}`).digest('hex');
  }

  static generateGuestToken(): string {
    return 'gt_' + randomBytes(16).toString('hex');
  }

  resolveOwner(user: any, guestToken?: string): OwnerContext {
    if (user?.id) {
      return {
        ownerKey: BatchJobService.hashOwnerKey('user', user.id),
        ownerType: 'user',
        organizationId: user.organizationId,
        userId: user.id,
        isGuest: false,
      };
    }
    const token = guestToken || BatchJobService.generateGuestToken();
    return {
      ownerKey: BatchJobService.hashOwnerKey('guest', token),
      ownerType: 'guest',
      isGuest: true,
      guestToken: token,
    };
  }

  // ── One-active-job enforcement ─────────────────────────────────────────────

  async getActiveJob(ownerKey: string): Promise<BatchJobEntity | null> {
    return this.jobRepo.findOne({
      where: { ownerKey, status: In(['pending', 'running', 'paused'] as BatchJobStatus[]) },
    });
  }

  // ── Job lifecycle ──────────────────────────────────────────────────────────

  async createJob(
    owner: OwnerContext,
    method: BatchJobMethod,
    items: BatchItemDto[],
    source: 'api' | 'csv',
    originalFilename?: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ job: BatchJobEntity; guestToken?: string }> {
    const maxItems = owner.isGuest ? GUEST_MAX_ITEMS : USER_MAX_ITEMS;
    if (items.length > maxItems) {
      throw new BadRequestException(
        `Maximum ${maxItems} items allowed per job for ${owner.ownerType} users.`,
      );
    }

    const active = await this.getActiveJob(owner.ownerKey);
    if (active) {
      throw new ConflictException({
        error: 'ACTIVE_JOB_EXISTS',
        message: 'You already have an active batch job.',
        activeJobId: active.id,
      });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (owner.isGuest ? GUEST_EXPIRY_DAYS : USER_EXPIRY_DAYS));

    const job = this.jobRepo.create({
      ownerKey: owner.ownerKey,
      ownerType: owner.ownerType,
      organizationId: owner.organizationId ?? null,
      userId: owner.userId ?? null,
      method,
      status: 'pending',
      totalItems: items.length,
      processedItems: 0,
      failedItems: 0,
      source,
      originalFilename: originalFilename ?? null,
      expiresAt,
      metadata: metadata ?? null,
    });
    await this.jobRepo.save(job);

    // Bulk insert items
    const itemEntities = items.map((item, i) =>
      this.itemRepo.create({
        jobId: job.id,
        rowIndex: i,
        referenceId: item.referenceId ?? null,
        query: item.query.trim(),
        status: 'pending',
      }),
    );
    await this.itemRepo.save(itemEntities);

    // Enqueue coordinator
    await this.queueService.sendJob(BATCH_COORDINATOR_QUEUE, { jobId: job.id });

    this.logger.log(`Batch job created: ${job.id} (${items.length} items, method=${method})`);
    return { job };
  }

  async getJob(jobId: string, ownerKey: string): Promise<BatchJobEntity> {
    const job = await this.jobRepo.findOne({ where: { id: jobId, ownerKey } });
    if (!job) throw new NotFoundException(`Batch job ${jobId} not found`);
    return job;
  }

  async listJobs(
    ownerKey: string,
    status?: string,
    limit = 20,
  ): Promise<BatchJobEntity[]> {
    const where: Record<string, unknown> = { ownerKey };
    if (status) where.status = status;
    return this.jobRepo.find({ where, order: { createdAt: 'DESC' }, take: Math.min(limit, 50) });
  }

  async getJobItems(
    jobId: string,
    ownerKey: string,
    page = 1,
    limit = 100,
  ): Promise<{ items: BatchJobItemEntity[]; total: number }> {
    await this.getJob(jobId, ownerKey); // ownership check
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 200);
    const [items, total] = await this.itemRepo.findAndCount({
      where: { jobId },
      order: { rowIndex: 'ASC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
    return { items, total };
  }

  async getJobCsv(jobId: string, ownerKey: string): Promise<string> {
    await this.getJob(jobId, ownerKey);
    const items = await this.itemRepo.find({
      where: { jobId },
      order: { rowIndex: 'ASC' },
    });
    const rows = items.map((item) => ({
      row_index: item.rowIndex,
      reference_id: item.referenceId ?? '',
      query: item.query,
      status: item.status,
      hts_number: item.htsNumber ?? '',
      description: item.description ?? '',
      confidence: item.confidence != null ? Number(item.confidence).toFixed(4) : '',
      error: item.errorMessage ?? '',
    }));
    return csvStringify(rows, { header: true });
  }

  async cancelJob(jobId: string, ownerKey: string): Promise<BatchJobEntity> {
    const job = await this.getJob(jobId, ownerKey);
    if (['completed', 'cancelled', 'failed'].includes(job.status)) {
      throw new BadRequestException(`Job is already ${job.status}`);
    }
    await this.jobRepo.update(job.id, { status: 'cancelled', completedAt: new Date() });
    return { ...job, status: 'cancelled' };
  }

  async pauseJob(jobId: string, ownerKey: string): Promise<BatchJobEntity> {
    const job = await this.getJob(jobId, ownerKey);
    if (job.status !== 'running' && job.status !== 'pending') {
      throw new BadRequestException(`Cannot pause a job with status "${job.status}"`);
    }
    await this.jobRepo.update(job.id, { status: 'paused' });
    return { ...job, status: 'paused' };
  }

  async resumeJob(jobId: string, ownerKey: string): Promise<BatchJobEntity> {
    const job = await this.getJob(jobId, ownerKey);
    if (job.status !== 'paused' && job.status !== 'failed') {
      throw new BadRequestException(`Cannot resume a job with status "${job.status}"`);
    }
    await this.jobRepo.update(job.id, { status: 'running' });
    // Re-enqueue coordinator to continue from where it left off
    await this.queueService.sendJob(BATCH_COORDINATOR_QUEUE, { jobId: job.id, resume: true });
    return { ...job, status: 'running' };
  }

  // ── Called by coordinator worker ───────────────────────────────────────────

  async startJobExecution(jobId: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job || ['cancelled', 'completed'].includes(job.status)) return;

    await this.jobRepo.update(jobId, { status: 'running', startedAt: new Date() });

    const pendingItems = await this.itemRepo.find({
      where: { jobId, status: 'pending' },
      order: { rowIndex: 'ASC' },
      select: ['id', 'rowIndex'],
    });

    this.logger.log(`[Coordinator] Enqueuing ${pendingItems.length} items for job ${jobId}`);

    for (const item of pendingItems) {
      await this.queueService.sendJob(BATCH_ITEM_QUEUE, { jobId, itemId: item.id });
    }
  }

  async recordItemResult(
    jobId: string,
    itemId: string,
    result: {
      htsNumber?: string;
      description?: string;
      fullDescription?: string[];
      confidence?: number;
      topResults?: unknown[];
      phases?: Record<string, unknown>;
      errorMessage?: string;
      processingMs: number;
    },
  ): Promise<void> {
    const success = !result.errorMessage;

    await this.itemRepo.update(itemId, {
      status: success ? 'completed' : 'failed',
      htsNumber: result.htsNumber ?? null,
      description: result.description ?? null,
      fullDescription: result.fullDescription ?? null,
      confidence: result.confidence != null ? result.confidence : null,
      topResults: (result.topResults ?? null) as any,
      phases: (result.phases ?? null) as any,
      errorMessage: result.errorMessage ?? null,
      processingMs: result.processingMs,
      completedAt: new Date(),
    });

    // Atomically increment counters
    await this.jobRepo
      .createQueryBuilder()
      .update(BatchJobEntity)
      .set({
        processedItems: () => 'processed_items + 1',
        ...(success ? {} : { failedItems: () => 'failed_items + 1' }),
      })
      .where('id = :id', { id: jobId })
      .execute();

    // Check if job is fully complete
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) return;
    if (job.processedItems >= job.totalItems) {
      const finalStatus = job.failedItems === job.totalItems ? 'failed' : 'completed';
      await this.jobRepo.update(jobId, { status: finalStatus, completedAt: new Date() });
      this.logger.log(`[Job ${jobId}] Complete: status=${finalStatus}`);
    }
  }

  async getItem(itemId: string): Promise<BatchJobItemEntity | null> {
    return this.itemRepo.findOne({ where: { id: itemId } });
  }

  async markItemSkipped(itemId: string): Promise<void> {
    await this.itemRepo.update(itemId, { status: 'skipped', completedAt: new Date() });
    // Still count as processed so totals remain consistent for cancelled jobs
    const item = await this.itemRepo.findOne({ where: { id: itemId }, select: ['jobId'] });
    if (item) {
      await this.jobRepo
        .createQueryBuilder()
        .update(BatchJobEntity)
        .set({ processedItems: () => 'processed_items + 1' })
        .where('id = :id', { id: item.jobId })
        .execute();
    }
  }

  /**
   * Reset a dequeued item back to pending when the job is paused.
   * Does NOT increment processedItems — the item will be re-queued on resume.
   */
  async requeueItem(itemId: string): Promise<void> {
    await this.itemRepo.update(itemId, { status: 'pending', completedAt: null });
  }
}
