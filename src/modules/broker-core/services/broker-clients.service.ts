import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { EncryptedSecretService } from '../../security/encrypted-secret.service';
import {
  CreateBrokerClientDto,
  ListBrokerClientsDto,
  UpdateBrokerClientDto,
  UpsertPoaDto,
} from '../dto/broker-core.dto';
import {
  BrokerClientEntity,
  BrokerPowerOfAttorneyEntity,
} from '../entities';

@Injectable()
export class BrokerClientsService {
  constructor(
    @InjectRepository(BrokerClientEntity)
    private readonly clients: Repository<BrokerClientEntity>,
    @InjectRepository(BrokerPowerOfAttorneyEntity)
    private readonly poas: Repository<BrokerPowerOfAttorneyEntity>,
    private readonly encryptedSecrets: EncryptedSecretService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, dto: ListBrokerClientsDto) {
    this.assertAuthenticated(ctx);
    const limit = dto.limit ?? 25;
    const offset = dto.offset ?? 0;

    const qb = this.clients
      .createQueryBuilder('client')
      .where('client.brokerOrganizationId = :brokerOrgId', {
        brokerOrgId: ctx.organizationId,
      });

    if (dto.status) {
      qb.andWhere('client.status = :status', { status: dto.status });
    }
    if (dto.q?.trim()) {
      qb.andWhere(
        '(client.name ILIKE :q OR client.legalName ILIKE :q OR client.contactEmail ILIKE :q)',
        { q: `%${dto.q.trim()}%` },
      );
    }

    qb.orderBy('client.updatedAt', 'DESC').take(limit).skip(offset);
    const [rows, total] = await qb.getManyAndCount();
    return {
      rows: rows.map((row) => this.toResponse(row)),
      total,
      limit,
      offset,
    };
  }

  async create(ctx: RequestContext, dto: CreateBrokerClientDto) {
    this.assertAuthenticated(ctx);
    const importerId = dto.importerId?.trim();

    const entity = this.clients.create({
      brokerOrganizationId: ctx.organizationId,
      clientOrganizationId: dto.clientOrganizationId ?? null,
      name: dto.name.trim(),
      legalName: dto.legalName?.trim() || null,
      importerIdLast4: importerId ? importerId.slice(-4) : null,
      encryptedImporterId: importerId
        ? this.encryptedSecrets.encrypt(importerId)
        : null,
      defaultCurrency: dto.defaultCurrency ?? null,
      contactEmail: dto.contactEmail ?? null,
      contactPhone: dto.contactPhone ?? null,
      address: dto.address ?? null,
      settings: dto.settings ?? null,
      notes: dto.notes ?? null,
      status: dto.status ?? 'active',
    });

    const saved = await this.clients.save(entity);
    await this.audit.record({
      eventType: 'broker_core.client.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_client',
      resourceId: saved.id,
      source: 'broker-core',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return this.toResponse(saved);
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateBrokerClientDto,
  ) {
    const client = await this.requireOwned(ctx, id);
    if (dto.name) client.name = dto.name.trim();
    if (dto.legalName !== undefined) {
      client.legalName = dto.legalName?.trim() || null;
    }
    if (dto.clientOrganizationId !== undefined) {
      client.clientOrganizationId = dto.clientOrganizationId ?? null;
    }
    if (dto.importerId !== undefined) {
      const importerId = dto.importerId?.trim();
      client.importerIdLast4 = importerId ? importerId.slice(-4) : null;
      client.encryptedImporterId = importerId
        ? this.encryptedSecrets.encrypt(importerId)
        : null;
    }
    if (dto.defaultCurrency !== undefined) {
      client.defaultCurrency = dto.defaultCurrency ?? null;
    }
    if (dto.contactEmail !== undefined) {
      client.contactEmail = dto.contactEmail ?? null;
    }
    if (dto.contactPhone !== undefined) {
      client.contactPhone = dto.contactPhone ?? null;
    }
    if (dto.address !== undefined) client.address = dto.address ?? null;
    if (dto.settings !== undefined) client.settings = dto.settings ?? null;
    if (dto.notes !== undefined) client.notes = dto.notes ?? null;
    if (dto.status !== undefined) client.status = dto.status;
    if (dto.reconciliationTolerancePct !== undefined) {
      client.reconciliationTolerancePct =
        dto.reconciliationTolerancePct == null
          ? null
          : String(dto.reconciliationTolerancePct);
    }

    const saved = await this.clients.save(client);
    await this.audit.record({
      eventType: 'broker_core.client.updated',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_client',
      resourceId: saved.id,
      source: 'broker-core',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return this.toResponse(saved);
  }

  async get(ctx: RequestContext, id: string) {
    const client = await this.requireOwned(ctx, id);
    const poa = await this.poas.findOne({
      where: { clientId: client.id },
      order: { effectiveDate: 'DESC' },
    });
    return {
      ...this.toResponse(client),
      poa: poa ? this.toPoaResponse(poa) : null,
    };
  }

  async upsertPoa(ctx: RequestContext, clientId: string, dto: UpsertPoaDto) {
    const client = await this.requireOwned(ctx, clientId);
    const existing = await this.poas.findOne({
      where: { clientId: client.id },
      order: { effectiveDate: 'DESC' },
    });

    const poa = this.poas.create({
      ...(existing ?? {}),
      clientId: client.id,
      brokerOrganizationId: ctx.organizationId,
      status: dto.status ?? existing?.status ?? 'pending',
      poaType: dto.poaType ?? existing?.poaType ?? 'continuous',
      effectiveDate: dto.effectiveDate ?? existing?.effectiveDate ?? null,
      expiresAt: dto.expiresAt ?? existing?.expiresAt ?? null,
      documentStorageKey:
        dto.documentStorageKey ?? existing?.documentStorageKey ?? null,
      notes: dto.notes ?? existing?.notes ?? null,
    });

    if (dto.status === 'verified') {
      poa.verifiedByUserId = ctx.userId;
      poa.verifiedAt = new Date();
    }

    const saved = await this.poas.save(poa);
    await this.audit.record({
      eventType: 'broker_core.poa.upserted',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_power_of_attorney',
      resourceId: saved.id,
      source: 'broker-core',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { status: saved.status },
    });
    return this.toPoaResponse(saved);
  }

  private async requireOwned(ctx: RequestContext, id: string) {
    this.assertAuthenticated(ctx);
    const client = await this.clients.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Broker client not found');
    if (client.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Broker client belongs to another tenant');
    }
    return client;
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }

  private toResponse(client: BrokerClientEntity) {
    return {
      id: client.id,
      brokerOrganizationId: client.brokerOrganizationId,
      clientOrganizationId: client.clientOrganizationId,
      name: client.name,
      legalName: client.legalName,
      importerIdLast4: client.importerIdLast4,
      hasImporterId: Boolean(client.encryptedImporterId),
      defaultCurrency: client.defaultCurrency,
      contactEmail: client.contactEmail,
      contactPhone: client.contactPhone,
      address: client.address,
      settings: client.settings,
      status: client.status,
      notes: client.notes,
      reconciliationTolerancePct:
        client.reconciliationTolerancePct == null
          ? null
          : Number(client.reconciliationTolerancePct),
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }

  private toPoaResponse(poa: BrokerPowerOfAttorneyEntity) {
    return {
      id: poa.id,
      clientId: poa.clientId,
      status: poa.status,
      poaType: poa.poaType,
      effectiveDate: poa.effectiveDate,
      expiresAt: poa.expiresAt,
      documentStorageKey: poa.documentStorageKey,
      verifiedByUserId: poa.verifiedByUserId,
      verifiedAt: poa.verifiedAt,
      notes: poa.notes,
      createdAt: poa.createdAt,
      updatedAt: poa.updatedAt,
    };
  }
}
