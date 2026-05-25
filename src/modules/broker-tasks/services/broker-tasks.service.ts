import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { BrokerClientRelationshipEntity } from '../../broker-core/entities/broker-client-relationship.entity';
import { BrokerEntryEntity } from '../../broker-entries/entities/broker-entry.entity';
import { BrokerShipmentEntity } from '../../broker-entries/entities/broker-shipment.entity';
import { NotificationService } from '../../notifications/notification.service';
import {
  AnswerTaskDto,
  CreateMissingInfoTaskDto,
} from '../dto/broker-tasks.dto';
import { BrokerMissingInfoTaskEntity } from '../entities';
import { BrokerStatusService } from './broker-status.service';

@Injectable()
export class BrokerTasksService {
  private readonly logger = new Logger(BrokerTasksService.name);

  constructor(
    @InjectRepository(BrokerMissingInfoTaskEntity)
    private readonly tasks: Repository<BrokerMissingInfoTaskEntity>,
    @InjectRepository(BrokerClientRelationshipEntity)
    private readonly relationships: Repository<BrokerClientRelationshipEntity>,
    @InjectRepository(BrokerShipmentEntity)
    private readonly shipments: Repository<BrokerShipmentEntity>,
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizations: Repository<OrganizationEntity>,
    private readonly status: BrokerStatusService,
    private readonly audit: AuditService,
    @Optional()
    private readonly notifications: NotificationService | null = null,
  ) {}

  async createForBroker(ctx: RequestContext, dto: CreateMissingInfoTaskDto) {
    this.assertAuthenticated(ctx);
    const relationship = await this.relationships.findOne({
      where: { id: dto.relationshipId },
    });
    if (!relationship) throw new NotFoundException('Relationship not found');
    if (relationship.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Relationship belongs to another tenant');
    }

    const task = this.tasks.create({
      brokerOrganizationId: relationship.brokerOrganizationId,
      businessOrganizationId: relationship.businessOrganizationId,
      relationshipId: relationship.id,
      clientId: relationship.clientId,
      entryId: dto.entryId ?? null,
      lineId: dto.lineId ?? null,
      fieldExtractedId: dto.fieldExtractedId ?? null,
      fieldPath: dto.fieldPath ?? null,
      prompt: dto.prompt,
      detail: dto.detail ?? null,
      severity: dto.severity ?? 'warning',
      createdByUserId: ctx.userId,
      dueAt: dto.dueAt ?? null,
      status: 'pending_client',
    });
    const saved = await this.tasks.save(task);

    await this.status.record({
      brokerOrganizationId: relationship.brokerOrganizationId,
      businessOrganizationId: relationship.businessOrganizationId,
      relationshipId: relationship.id,
      entryId: dto.entryId ?? null,
      eventType: 'task.missing_info_requested',
      headline: `Broker requested info: ${dto.prompt}`,
      severity: 'info',
      metadata: { taskId: saved.id },
    });

    await this.audit.record({
      eventType: 'broker_tasks.missing_info.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_missing_info_task',
      resourceId: saved.id,
      source: 'broker-tasks',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { relationshipId: relationship.id },
    });

    // R1-D-03 — notify the business org. Best-effort: failures don't roll
    // back the task, since the broker can also resend it from the UI.
    await this.notifyTaskCreated(saved, relationship).catch((err) =>
      this.logger.warn(
        `Task ${saved.id} notification failed: ${(err as Error).message}`,
      ),
    );

    return saved;
  }

  private async notifyTaskCreated(
    task: BrokerMissingInfoTaskEntity,
    relationship: BrokerClientRelationshipEntity,
  ) {
    if (!this.notifications) return;
    // Pick a recipient on the business org. Prefer the first active user in
    // the org; future work routes to a designated portal contact.
    const recipient = await this.users.findOne({
      where: {
        organizationId: relationship.businessOrganizationId,
        isActive: true,
      },
      order: { lastLoginAt: 'DESC' },
    });
    if (!recipient?.email) return;
    const brokerOrg = await this.organizations.findOne({
      where: { id: relationship.brokerOrganizationId },
    });
    const subject = `${brokerOrg?.name ?? 'Your broker'} needs information for your shipment`;
    await this.notifications.send({
      templateKey: 'broker.client_portal.task_created',
      subject,
      bodyText: `${brokerOrg?.name ?? 'Your broker'} requested: ${task.prompt}${
        task.detail ? `\n\n${task.detail}` : ''
      }\n\nReply through your client portal to keep the entry moving.`,
      recipient: {
        email: recipient.email,
        userId: recipient.id,
        organizationId: relationship.businessOrganizationId,
      },
      context: {
        taskId: task.id,
        relationshipId: relationship.id,
        brokerOrganizationId: relationship.brokerOrganizationId,
        severity: task.severity,
      },
    });
  }

  async listForBroker(
    ctx: RequestContext,
    params: { status?: string; relationshipId?: string } = {},
  ) {
    this.assertAuthenticated(ctx);
    const qb = this.tasks
      .createQueryBuilder('task')
      .where('task.brokerOrganizationId = :orgId', {
        orgId: ctx.organizationId,
      });
    if (params.status) {
      qb.andWhere('task.status = :status', { status: params.status });
    }
    if (params.relationshipId) {
      qb.andWhere('task.relationshipId = :rid', { rid: params.relationshipId });
    }
    qb.orderBy('task.createdAt', 'DESC').take(100);
    return qb.getMany();
  }

  async listForClient(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    return this.tasks.find({
      where: { businessOrganizationId: ctx.organizationId },
      order: { dueAt: 'ASC', createdAt: 'DESC' },
      take: 100,
    });
  }

  async answer(ctx: RequestContext, taskId: string, dto: AnswerTaskDto) {
    this.assertAuthenticated(ctx);
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.businessOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException(
        'Only the business client can answer this task',
      );
    }
    if (task.status === 'answered' || task.status === 'cancelled') {
      throw new BadRequestException(`Task is already ${task.status}`);
    }

    task.answer = dto.answer;
    task.answerAttachments = dto.attachments?.length ? dto.attachments : null;
    task.answeredAt = new Date();
    task.answeredByUserId = ctx.userId;
    task.status = 'answered';
    const saved = await this.tasks.save(task);

    await this.status.record({
      brokerOrganizationId: task.brokerOrganizationId,
      businessOrganizationId: task.businessOrganizationId,
      relationshipId: task.relationshipId,
      entryId: task.entryId,
      eventType: 'task.missing_info_answered',
      headline: 'Client answered missing-info question',
      severity: 'success',
      metadata: { taskId: saved.id },
    });

    await this.audit.record({
      eventType: 'broker_tasks.missing_info.answered',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_missing_info_task',
      resourceId: saved.id,
      source: 'broker-tasks',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return saved;
  }

  async cancel(ctx: RequestContext, taskId: string) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Only the broker can cancel this task');
    }
    task.status = 'cancelled';
    const saved = await this.tasks.save(task);
    await this.audit.record({
      eventType: 'broker_tasks.missing_info.cancelled',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_missing_info_task',
      resourceId: saved.id,
      source: 'broker-tasks',
    });
    return saved;
  }

  /**
   * Returns tasks that have been pending_client for >24h and haven't been
   * notified in the last 24h. Used by the notification job.
   */
  async findStaleTasks(): Promise<BrokerMissingInfoTaskEntity[]> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.tasks
      .createQueryBuilder('task')
      .where('task.status = :status', { status: 'pending_client' })
      .andWhere('task.createdAt < :cutoff', { cutoff })
      .andWhere('(task.notifiedAt IS NULL OR task.notifiedAt < :cutoff)', {
        cutoff,
      })
      .orderBy('task.createdAt', 'ASC')
      .take(100)
      .getMany();
  }

  async markNotified(taskId: string) {
    await this.tasks.update(taskId, { notifiedAt: new Date() });
  }

  /**
   * Plan endpoint backing GET /broker-portal/shipments — returns shipments
   * tied to relationships where the caller is the business org. Each row is
   * augmented with the active entry status (if any) so the portal can show
   * "Cleared", "In review", etc.
   */
  async listClientShipments(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    const relationships = await this.relationships.find({
      where: { businessOrganizationId: ctx.organizationId, status: 'active' },
    });
    if (!relationships.length) return [];
    const clientIds = Array.from(
      new Set(
        relationships
          .map((r) => r.clientId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (!clientIds.length) return [];
    const shipments = await this.shipments
      .createQueryBuilder('s')
      .where('s.clientId IN (:...clientIds)', { clientIds })
      .orderBy('s.eta', 'ASC')
      .addOrderBy('s.createdAt', 'DESC')
      .take(100)
      .getMany();
    if (!shipments.length) return [];

    const entries = await this.entries
      .createQueryBuilder('e')
      .where('e.shipmentId IN (:...sids)', {
        sids: shipments.map((s) => s.id),
      })
      .getMany();
    const entryByShipment = new Map<string, BrokerEntryEntity>();
    for (const entry of entries) {
      if (entry.shipmentId) entryByShipment.set(entry.shipmentId, entry);
    }

    return shipments.map((s) => ({
      id: s.id,
      shipmentReference: s.shipmentReference,
      mode: s.mode,
      originCountry: s.originCountry,
      destinationCountry: s.destinationCountry,
      portOfLading: s.portOfLading,
      portOfUnlading: s.portOfUnlading,
      eta: s.eta,
      shipmentStatus: s.status,
      entry: entryByShipment.get(s.id)
        ? {
            id: entryByShipment.get(s.id)!.id,
            entryNumber: entryByShipment.get(s.id)!.entryNumber,
            status: entryByShipment.get(s.id)!.status,
          }
        : null,
    }));
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }
}
