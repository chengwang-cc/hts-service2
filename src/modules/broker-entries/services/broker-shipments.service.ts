import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { BrokerClientEntity } from '../../broker-core/entities/broker-client.entity';
import { CreateShipmentDto } from '../dto/broker-entries.dto';
import { BrokerShipmentEntity } from '../entities';

@Injectable()
export class BrokerShipmentsService {
  constructor(
    @InjectRepository(BrokerShipmentEntity)
    private readonly shipments: Repository<BrokerShipmentEntity>,
    private readonly audit: AuditService,
    @Optional()
    @InjectRepository(BrokerClientEntity)
    private readonly clients: Repository<BrokerClientEntity> | null = null,
  ) {}

  async list(ctx: RequestContext, clientId?: string) {
    this.assertAuthenticated(ctx);
    const where: Record<string, string> = {
      brokerOrganizationId: ctx.organizationId,
    };
    if (clientId) where.clientId = clientId;
    const rows = await this.shipments.find({
      where: where as never,
      order: { eta: 'ASC', createdAt: 'DESC' },
      take: 100,
    });
    return rows;
  }

  async create(ctx: RequestContext, dto: CreateShipmentDto) {
    this.assertAuthenticated(ctx);
    await this.requireOwnedClient(ctx, dto.clientId);
    const entity = this.shipments.create({
      brokerOrganizationId: ctx.organizationId,
      clientId: dto.clientId,
      shipmentReference: dto.shipmentReference ?? null,
      mode: dto.mode,
      carrierName: dto.carrierName ?? null,
      vesselOrFlight: dto.vesselOrFlight ?? null,
      originCountry: dto.originCountry ?? null,
      destinationCountry: dto.destinationCountry ?? null,
      portOfLading: dto.portOfLading ?? null,
      portOfUnlading: dto.portOfUnlading ?? null,
      eta: dto.eta ?? null,
      metadata: dto.metadata ?? null,
    });
    const saved = await this.shipments.save(entity);
    await this.audit.record({
      eventType: 'broker_entries.shipment.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_shipment',
      resourceId: saved.id,
      source: 'broker-entries',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return saved;
  }

  async get(ctx: RequestContext, id: string) {
    return this.requireOwnedShipment(ctx, id);
  }

  async requireOwnedShipment(ctx: RequestContext, id: string) {
    const shipment = await this.shipments.findOne({ where: { id } });
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (shipment.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Shipment belongs to another tenant');
    }
    return shipment;
  }

  private async requireOwnedClient(ctx: RequestContext, clientId: string) {
    if (!this.clients) return;
    const client = await this.clients.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Broker client not found');
    if (client.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Broker client belongs to another tenant');
    }
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }
}
