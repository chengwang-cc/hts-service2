import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { UpdateRelationshipChecklistDto } from '../dto/broker-core.dto';
import { BrokerClientRelationshipEntity } from '../entities';

export interface CreateRelationshipInput {
  brokerOrganizationId: string;
  businessOrganizationId: string;
  clientId?: string | null;
  brokerProfileId?: string | null;
  marketplaceRequestId?: string | null;
  marketplaceQuoteId?: string | null;
  initialChecklist?: BrokerClientRelationshipEntity['onboardingChecklist'];
}

@Injectable()
export class BrokerRelationshipsService {
  constructor(
    @InjectRepository(BrokerClientRelationshipEntity)
    private readonly relationships: Repository<BrokerClientRelationshipEntity>,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateRelationshipInput, manager?: EntityManager) {
    const relationships =
      manager?.getRepository(BrokerClientRelationshipEntity) ??
      this.relationships;
    const entity = relationships.create({
      brokerOrganizationId: input.brokerOrganizationId,
      businessOrganizationId: input.businessOrganizationId,
      clientId: input.clientId ?? null,
      brokerProfileId: input.brokerProfileId ?? null,
      marketplaceRequestId: input.marketplaceRequestId ?? null,
      marketplaceQuoteId: input.marketplaceQuoteId ?? null,
      status: 'active',
      poaStatus: 'missing',
      startedAt: new Date(),
      onboardingChecklist:
        input.initialChecklist ?? this.defaultOnboardingChecklist(),
    });
    const saved = await relationships.save(entity);
    await this.audit.record(
      {
        eventType: 'broker_core.relationship.created',
        organizationId: input.brokerOrganizationId,
        resourceType: 'broker_client_relationship',
        resourceId: saved.id,
        source: 'broker-core',
        metadata: {
          businessOrganizationId: input.businessOrganizationId,
          marketplaceRequestId: input.marketplaceRequestId,
        },
      },
      manager,
    );
    return this.toResponse(saved);
  }

  async listForBroker(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    const rows = await this.relationships.find({
      where: { brokerOrganizationId: ctx.organizationId },
      order: { startedAt: 'DESC' },
      take: 100,
    });
    return rows.map((row) => this.toResponse(row));
  }

  /**
   * Looks up the relationship that was created when a specific quote was
   * accepted. Used by the rescind flow to pause it.
   */
  async findByMarketplaceQuoteId(
    marketplaceQuoteId: string,
  ): Promise<BrokerClientRelationshipEntity | null> {
    return this.relationships.findOne({ where: { marketplaceQuoteId } });
  }

  /**
   * Status transition helper used by the rescind flow. Records an audit
   * row; callers may pass extra metadata to explain why.
   */
  async updateStatus(
    id: string,
    status: BrokerClientRelationshipEntity['status'],
    ctx: RequestContext | null,
    metadata?: Record<string, unknown>,
  ) {
    const relationship = await this.relationships.findOne({ where: { id } });
    if (!relationship) throw new NotFoundException('Relationship not found');
    relationship.status = status;
    if (status === 'terminated' && !relationship.endedAt) {
      relationship.endedAt = new Date();
    }
    const saved = await this.relationships.save(relationship);
    await this.audit.record({
      eventType: 'broker_core.relationship.status_changed',
      organizationId: relationship.brokerOrganizationId,
      actorUserId: ctx?.userId,
      resourceType: 'broker_client_relationship',
      resourceId: saved.id,
      source: 'broker-core',
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { status, ...(metadata ?? {}) },
    });
    return saved;
  }

  async listForBusiness(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    const rows = await this.relationships.find({
      where: { businessOrganizationId: ctx.organizationId },
      order: { startedAt: 'DESC' },
      take: 100,
    });
    return rows.map((row) => this.toResponse(row));
  }

  async updateChecklist(
    ctx: RequestContext,
    id: string,
    dto: UpdateRelationshipChecklistDto,
  ) {
    this.assertAuthenticated(ctx);
    const relationship = await this.relationships.findOne({ where: { id } });
    if (!relationship) {
      throw new NotFoundException('Relationship not found');
    }

    const isParticipant =
      relationship.brokerOrganizationId === ctx.organizationId ||
      relationship.businessOrganizationId === ctx.organizationId;
    if (!isParticipant) {
      throw new ForbiddenException('Relationship belongs to another tenant');
    }

    relationship.onboardingChecklist = dto.items.map((item) => ({
      key: item.key,
      label: item.label,
      status: item.status,
      completedAt:
        item.status === 'completed' ? new Date().toISOString() : null,
    }));

    const saved = await this.relationships.save(relationship);
    await this.audit.record({
      eventType: 'broker_core.relationship.checklist_updated',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_client_relationship',
      resourceId: saved.id,
      source: 'broker-core',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return this.toResponse(saved);
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }

  private defaultOnboardingChecklist(): BrokerClientRelationshipEntity['onboardingChecklist'] {
    return [
      {
        key: 'poa',
        label: 'Collect and verify Power of Attorney',
        status: 'pending',
        completedAt: null,
      },
      {
        key: 'importer_id',
        label: 'Confirm importer of record number',
        status: 'pending',
        completedAt: null,
      },
      {
        key: 'standard_documents',
        label: 'Request commercial invoice and packing list',
        status: 'pending',
        completedAt: null,
      },
      {
        key: 'sop',
        label: 'Confirm client clearance SOP',
        status: 'pending',
        completedAt: null,
      },
    ];
  }

  private toResponse(relationship: BrokerClientRelationshipEntity) {
    return {
      id: relationship.id,
      brokerOrganizationId: relationship.brokerOrganizationId,
      businessOrganizationId: relationship.businessOrganizationId,
      clientId: relationship.clientId,
      brokerProfileId: relationship.brokerProfileId,
      marketplaceRequestId: relationship.marketplaceRequestId,
      marketplaceQuoteId: relationship.marketplaceQuoteId,
      status: relationship.status,
      poaStatus: relationship.poaStatus,
      startedAt: relationship.startedAt,
      endedAt: relationship.endedAt,
      onboardingChecklist: relationship.onboardingChecklist,
      createdAt: relationship.createdAt,
      updatedAt: relationship.updatedAt,
    };
  }
}
