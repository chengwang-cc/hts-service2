import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { QueueService } from '../../queue/queue.service';
import { AuditEventEntity } from '../entities/audit-event.entity';

export const AUDIT_RETENTION_QUEUE = 'audit.retention.tick';

/**
 * R4-A-04 — periodic deletion of audit events older than the configured
 * retention window. The default is 365 days; operators can override via
 * AUDIT_RETENTION_DAYS. A future revision lands cold-storage archive
 * before delete; for now we just trim the hot table to keep the index hot.
 *
 * Batched delete: caps per-tick to AUDIT_RETENTION_BATCH (default 1000)
 * so a backlog from a long-paused service doesn't lock the table.
 */
@Injectable()
export class AuditRetentionWorker implements OnModuleInit {
  private readonly logger = new Logger(AuditRetentionWorker.name);

  constructor(
    @InjectRepository(AuditEventEntity)
    private readonly audit: Repository<AuditEventEntity>,
    private readonly queue: QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(
      AUDIT_RETENTION_QUEUE,
      async () => {
        const deleted = await this.tick().catch((err) => {
          this.logger.error(
            `Audit retention tick failed: ${(err as Error).message}`,
          );
          return 0;
        });
        if (deleted > 0) {
          this.logger.log(`Audit retention deleted ${deleted} event(s)`);
        }
      },
      { teamSize: 1, teamConcurrency: 1 },
    );
    if (process.env.JEST_WORKER_ID !== undefined) return;
    const cron = process.env.AUDIT_RETENTION_CRON || '0 3 * * *';
    try {
      await this.queue.scheduleJob(AUDIT_RETENTION_QUEUE, cron);
      this.logger.log(`Audit retention cron scheduled: ${cron}`);
    } catch (err) {
      this.logger.warn(
        `Failed to schedule audit retention cron: ${(err as Error).message}`,
      );
    }
  }

  async tick(): Promise<number> {
    const days = Number(process.env.AUDIT_RETENTION_DAYS || 365);
    const batch = Number(process.env.AUDIT_RETENTION_BATCH || 1000);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Find the IDs to delete first so we can cap the per-tick footprint.
    const candidates = await this.audit.find({
      where: { createdAt: LessThan(cutoff) as any },
      select: ['id'],
      take: batch,
      order: { createdAt: 'ASC' },
    });
    if (candidates.length === 0) return 0;
    const ids = candidates.map((c) => c.id);
    const result = await this.audit
      .createQueryBuilder()
      .delete()
      .from(AuditEventEntity)
      .whereInIds(ids)
      .execute();
    return result.affected ?? ids.length;
  }
}
