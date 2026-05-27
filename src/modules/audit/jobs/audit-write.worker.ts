import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueService } from '../../queue/queue.service';
import { AuditEventEntity } from '../entities/audit-event.entity';

export const AUDIT_WRITE_QUEUE = 'audit.write';

/**
 * Background worker that drains the audit-write queue. Audit events
 * are enqueued by `AuditService.record(...)` on the request path; this
 * worker pulls them off and inserts them into `audit_events`.
 *
 * Failures are logged and ignored — audit writes are best-effort. The
 * job is NOT retried indefinitely (pg-boss `retryLimit: 2`) so a
 * persistent DB issue can't generate an unbounded backlog of identical
 * retries.
 *
 * In environments where the queue is disabled (`JEST_WORKER_ID`,
 * `QUEUE_DISABLED=true`), QueueService's inline fallback invokes this
 * handler synchronously, preserving the previous behavior for tests.
 */
@Injectable()
export class AuditWriteWorker implements OnModuleInit {
  private readonly logger = new Logger(AuditWriteWorker.name);

  constructor(
    @InjectRepository(AuditEventEntity)
    private readonly auditEvents: Repository<AuditEventEntity>,
    private readonly queue: QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(
      AUDIT_WRITE_QUEUE,
      async (job) => {
        const payload = job.data as AuditWritePayload;
        try {
          const entity = this.auditEvents.create({
            eventType: payload.eventType,
            organizationId: payload.organizationId ?? null,
            actorUserId: payload.actorUserId ?? null,
            resourceType: payload.resourceType,
            resourceId: payload.resourceId ?? null,
            source: payload.source ?? null,
            ipAddress: payload.ipAddress ?? null,
            userAgent: payload.userAgent ?? null,
            metadata: payload.metadata ?? null,
          });
          await this.auditEvents.save(entity);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `audit write failed eventType=${payload.eventType} resource=${payload.resourceType}/${payload.resourceId ?? '-'}: ${message}`,
          );
        }
      },
      { teamSize: 4, teamConcurrency: 4 },
    );
  }
}

/**
 * Wire-format payload of an audit-write job. Kept primitive (strings +
 * JSON) so pg-boss can serialize it without TypeORM lifecycle hooks.
 */
export interface AuditWritePayload {
  eventType: string;
  organizationId?: string | null;
  actorUserId?: string | null;
  resourceType: string;
  resourceId?: string | null;
  source?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}
