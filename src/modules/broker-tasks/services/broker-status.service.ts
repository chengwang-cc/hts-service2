import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { BrokerStatusEventEntity } from '../entities';

export interface StatusEventInput {
  brokerOrganizationId?: string | null;
  businessOrganizationId?: string | null;
  relationshipId?: string | null;
  entryId?: string | null;
  shipmentId?: string | null;
  eventType: string;
  headline: string;
  detail?: string;
  severity?: BrokerStatusEventEntity['severity'];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class BrokerStatusService {
  constructor(
    @InjectRepository(BrokerStatusEventEntity)
    private readonly events: Repository<BrokerStatusEventEntity>,
  ) {}

  async record(input: StatusEventInput) {
    const event = this.events.create({
      brokerOrganizationId: input.brokerOrganizationId ?? null,
      businessOrganizationId: input.businessOrganizationId ?? null,
      relationshipId: input.relationshipId ?? null,
      entryId: input.entryId ?? null,
      shipmentId: input.shipmentId ?? null,
      eventType: input.eventType,
      headline: input.headline,
      detail: input.detail ?? null,
      severity: input.severity ?? 'info',
      metadata: input.metadata ?? null,
    });
    return this.events.save(event);
  }

  async listForRelationship(ctx: RequestContext, relationshipId: string) {
    this.assertAuthenticated(ctx);
    return this.events.find({
      where: [
        {
          relationshipId,
          brokerOrganizationId: ctx.organizationId,
        },
        {
          relationshipId,
          businessOrganizationId: ctx.organizationId,
        },
      ],
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async listForEntry(ctx: RequestContext, entryId: string) {
    this.assertAuthenticated(ctx);
    return this.events.find({
      where: [
        { entryId, brokerOrganizationId: ctx.organizationId },
        { entryId, businessOrganizationId: ctx.organizationId },
      ],
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }
}
