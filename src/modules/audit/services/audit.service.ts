import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { QueueService } from '../../queue/queue.service';
import { AuditEventEntity } from '../entities/audit-event.entity';
import {
  AUDIT_WRITE_QUEUE,
  AuditWritePayload,
} from '../jobs/audit-write.worker';

export interface AuditEventInput {
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

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEventEntity)
    private readonly auditEvents: Repository<AuditEventEntity>,
    @Optional() private readonly queue: QueueService | null = null,
  ) {}

  /**
   * Record an audit event.
   *
   * Two paths:
   *   - When `manager` is supplied, the event is saved synchronously
   *     against the caller's transaction so it commits/rolls back
   *     atomically with the domain mutation. The saved entity is
   *     returned.
   *   - Otherwise the event is enqueued onto pg-boss
   *     (`audit.write`) and persisted out-of-band by AuditWriteWorker.
   *     Returns `null` — callers that need the row id must use the
   *     in-transaction path.
   *
   * If the queue is unavailable (jest, QUEUE_DISABLED=true, or
   * QueueService not injected), pg-boss's inline fallback runs the
   * worker synchronously — behavior matches the previous direct save.
   * Failures are always swallowed: audit writes are best-effort and
   * never propagate to the request path.
   */
  async record(
    input: AuditEventInput,
    manager?: EntityManager,
  ): Promise<AuditEventEntity | null> {
    if (manager) {
      return this.saveInline(input, manager);
    }
    if (!this.queue) {
      return this.saveInline(input);
    }
    try {
      const payload: AuditWritePayload = {
        eventType: input.eventType,
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        source: input.source ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? null,
      };
      await this.queue.sendJob(AUDIT_WRITE_QUEUE, payload, {
        retryLimit: 2,
        retryDelay: 30,
      });
      return null;
    } catch (error) {
      // Queue submission itself failed — fall back to synchronous save
      // so we don't lose the event.
      const message =
        error instanceof Error ? error.message : 'Unknown queue submit failure';
      this.logger.warn(
        `audit enqueue failed, falling back to inline save: ${message}`,
      );
      return this.saveInline(input);
    }
  }

  private async saveInline(
    input: AuditEventInput,
    manager?: EntityManager,
  ): Promise<AuditEventEntity | null> {
    try {
      const auditEvents =
        manager?.getRepository(AuditEventEntity) ?? this.auditEvents;
      const event = auditEvents.create({
        eventType: input.eventType,
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        source: input.source ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? null,
      });

      return await auditEvents.save(event);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown audit event failure';
      this.logger.warn(`Failed to write audit event: ${message}`);
      return null;
    }
  }
}
