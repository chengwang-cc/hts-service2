import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditEventEntity } from '../entities/audit-event.entity';

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
  ) {}

  async record(
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
