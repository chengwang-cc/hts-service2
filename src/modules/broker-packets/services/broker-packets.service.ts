import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { BrokerClientEntity } from '../../broker-core/entities/broker-client.entity';
import { BrokerRelationshipsService } from '../../broker-core/services/broker-relationships.service';
import { BrokerEntriesService } from '../../broker-entries/services/broker-entries.service';
import {
  DocumentSecurityScanService,
} from '../../documents/document-security-scan.service';
import { DocumentStorageService } from '../../documents/document-storage.service';
import { QueueService } from '../../queue/queue.service';
import {
  ClientPortalUploadDto,
  CreatePacketDto,
  DraftEntryFromPacketDto,
  ListPacketsDto,
  ReviewFieldDto,
  UploadDocumentDto,
} from '../dto/broker-packets.dto';
import {
  BrokerDocumentEntity,
  BrokerDocumentPacketEntity,
  BrokerExtractedFieldEntity,
} from '../entities';
import { DocumentClassifierService } from './document-classifier.service';
import { FieldExtractorService } from './field-extractor.service';
import { PacketReconciliationService } from './reconciliation.service';
import { createHash } from 'crypto';

export const BROKER_PACKET_PROCESS_QUEUE = 'broker.packet.process';

@Injectable()
export class BrokerPacketsService {
  private readonly logger = new Logger(BrokerPacketsService.name);

  constructor(
    @InjectRepository(BrokerDocumentPacketEntity)
    private readonly packets: Repository<BrokerDocumentPacketEntity>,
    @InjectRepository(BrokerDocumentEntity)
    private readonly documents: Repository<BrokerDocumentEntity>,
    @InjectRepository(BrokerExtractedFieldEntity)
    private readonly fields: Repository<BrokerExtractedFieldEntity>,
    @InjectRepository(BrokerClientEntity)
    private readonly brokerClients: Repository<BrokerClientEntity>,
    private readonly scan: DocumentSecurityScanService,
    private readonly storage: DocumentStorageService,
    private readonly classifier: DocumentClassifierService,
    private readonly extractor: FieldExtractorService,
    private readonly reconciliation: PacketReconciliationService,
    private readonly queue: QueueService,
    private readonly relationships: BrokerRelationshipsService,
    private readonly entries: BrokerEntriesService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, dto: ListPacketsDto) {
    this.assertAuthenticated(ctx);
    const limit = dto.limit ?? 25;
    const offset = dto.offset ?? 0;
    const qb = this.packets
      .createQueryBuilder('packet')
      .where('packet.brokerOrganizationId = :orgId', {
        orgId: ctx.organizationId,
      });
    if (dto.clientId) {
      qb.andWhere('packet.clientId = :clientId', { clientId: dto.clientId });
    }
    if (dto.status) {
      qb.andWhere('packet.status = :status', { status: dto.status });
    }
    qb.orderBy('packet.createdAt', 'DESC').take(limit).skip(offset);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total, limit, offset };
  }

  async getDetail(ctx: RequestContext, id: string) {
    const packet = await this.requireOwned(ctx, id);
    const documents = await this.documents.find({
      where: { packetId: id },
      order: { createdAt: 'ASC' },
    });
    const fields = await this.fields.find({
      where: { packetId: id },
      order: { fieldPath: 'ASC' },
    });
    return { ...packet, documents, fields };
  }

  async create(ctx: RequestContext, dto: CreatePacketDto) {
    this.assertAuthenticated(ctx);
    if (!dto.documents?.length) {
      throw new BadRequestException('At least one document is required');
    }
    const packet = await this.packets.save(
      this.packets.create({
        brokerOrganizationId: ctx.organizationId,
        clientId: dto.clientId,
        shipmentId: dto.shipmentId ?? null,
        uploadedByUserId: ctx.userId,
        source: dto.source ?? 'broker',
        label: dto.label ?? null,
        status: 'pending',
        receivedAt: new Date(),
        metadata: dto.metadata ?? null,
      }),
    );

    await this.storeDocuments(ctx, packet, dto.documents);
    await this.enqueueProcessing(packet.id);

    await this.audit.record({
      eventType: 'broker_packets.packet.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_document_packet',
      resourceId: packet.id,
      source: 'broker-packets',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { documentCount: dto.documents.length },
    });
    return this.getDetail(ctx, packet.id);
  }

  async createFromPortal(ctx: RequestContext, dto: ClientPortalUploadDto) {
    this.assertAuthenticated(ctx);
    const relationships = await this.relationships.listForBusiness(ctx);
    const relationship = relationships.find(
      (r) => r.id === dto.relationshipId,
    );
    if (!relationship) {
      throw new NotFoundException('Relationship not found');
    }
    if (!relationship.clientId) {
      throw new BadRequestException(
        'Broker has not finalized client onboarding yet',
      );
    }

    const packet = await this.packets.save(
      this.packets.create({
        brokerOrganizationId: relationship.brokerOrganizationId,
        clientId: relationship.clientId,
        source: 'client_portal',
        label: dto.label ?? 'Client portal upload',
        uploadedByUserId: ctx.userId,
        status: 'pending',
        receivedAt: new Date(),
        metadata: { uploadedByOrganizationId: ctx.organizationId },
      }),
    );

    // Use broker-org context for storing documents to keep tenant-isolation
    await this.storeDocuments(
      {
        userId: ctx.userId,
        organizationId: relationship.brokerOrganizationId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      packet,
      dto.documents,
    );

    await this.enqueueProcessing(packet.id);
    await this.audit.record({
      eventType: 'broker_packets.packet.client_uploaded',
      organizationId: relationship.brokerOrganizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_document_packet',
      resourceId: packet.id,
      source: 'broker-portal',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        relationshipId: relationship.id,
        documentCount: dto.documents.length,
      },
    });
    return packet;
  }

  async process(packetId: string): Promise<void> {
    const packet = await this.packets.findOne({ where: { id: packetId } });
    if (!packet) {
      this.logger.warn(`Packet ${packetId} not found during processing`);
      return;
    }
    packet.status = 'processing';
    packet.processingStartedAt = new Date();
    packet.processingError = null;
    await this.packets.save(packet);

    try {
      const documents = await this.documents.find({
        where: { packetId: packet.id },
      });
      for (const doc of documents) {
        if (doc.scanStatus === 'blocked') continue;
        const classification = await this.classifier.classifyAsync(
          doc.fileName,
          doc.mimeType,
        );
        doc.documentType = classification.documentType;
        doc.documentTypeConfidence = classification.confidence.toFixed(2);
        await this.documents.save(doc);

        const seeds = await this.extractor.extract({ document: doc });
        const fieldEntities = seeds.map((seed) =>
          this.fields.create({
            documentId: doc.id,
            packetId: packet.id,
            fieldPath: seed.fieldPath,
            rawValue: seed.rawValue,
            normalizedValue: seed.normalizedValue ?? null,
            confidence: seed.confidence.toFixed(2),
            page: seed.page ?? null,
            sourceModel: seed.sourceModel,
            acceptedStatus: 'suggested',
          }),
        );
        await this.fields.save(fieldEntities);
      }

      const allFields = await this.fields.find({
        where: { packetId: packet.id },
      });
      const tolerancePct = await this.resolveTolerance(packet.clientId);
      const reconciliation = this.reconciliation.reconcile(allFields, {
        tolerancePct,
      });

      packet.status = 'extracted';
      packet.processingCompletedAt = new Date();
      packet.reconciliation = reconciliation;
      await this.packets.save(packet);

      await this.audit.record({
        eventType: 'broker_packets.packet.extracted',
        organizationId: packet.brokerOrganizationId,
        resourceType: 'broker_document_packet',
        resourceId: packet.id,
        source: 'broker-packets',
        metadata: {
          documents: documents.length,
          reconciliationFindings: reconciliation.length,
        },
      });
    } catch (error) {
      packet.status = 'failed';
      packet.processingError =
        error instanceof Error ? error.message : 'Unknown extraction failure';
      await this.packets.save(packet);
      this.logger.error(
        `Packet ${packetId} processing failed: ${packet.processingError}`,
      );
    }
  }

  async reviewField(
    ctx: RequestContext,
    packetId: string,
    fieldId: string,
    dto: ReviewFieldDto,
  ) {
    await this.requireOwned(ctx, packetId);
    const field = await this.fields.findOne({
      where: { id: fieldId, packetId },
    });
    if (!field) throw new NotFoundException('Field not found');
    field.acceptedStatus = dto.status;
    if (dto.value !== undefined) field.reviewedValue = dto.value;
    field.reviewedByUserId = ctx.userId;
    field.reviewedAt = new Date();
    const saved = await this.fields.save(field);

    // Recompute reconciliation for the packet
    const allFields = await this.fields.find({ where: { packetId } });
    const reviewedPacket = await this.packets.findOne({
      where: { id: packetId },
    });
    const tolerancePct = await this.resolveTolerance(
      reviewedPacket?.clientId ?? null,
    );
    const reconciliation = this.reconciliation.reconcile(allFields, {
      tolerancePct,
    });
    await this.packets.update(packetId, { reconciliation });

    await this.audit.record({
      eventType: 'broker_packets.field.reviewed',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_extracted_field',
      resourceId: saved.id,
      source: 'broker-packets',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { acceptedStatus: saved.acceptedStatus },
    });
    return saved;
  }

  async draftEntryFromPacket(
    ctx: RequestContext,
    dto: DraftEntryFromPacketDto,
  ) {
    const packet = await this.requireOwned(ctx, dto.packetId);
    if (packet.status !== 'extracted' && packet.status !== 'reviewed') {
      throw new BadRequestException(
        'Packet must be reviewed before drafting an entry',
      );
    }

    const fields = await this.fields.find({
      where: { packetId: packet.id },
    });
    const acceptedByPath = new Map<string, string>();
    for (const f of fields) {
      if (f.acceptedStatus === 'accepted' || f.acceptedStatus === 'overridden') {
        const value =
          f.acceptedStatus === 'overridden'
            ? f.reviewedValue ?? f.normalizedValue ?? f.rawValue ?? ''
            : f.normalizedValue ?? f.rawValue ?? '';
        if (value) acceptedByPath.set(f.fieldPath, value);
      }
    }

    const lineDescription = acceptedByPath.get('invoice.line[0].description');
    const lineQuantity = Number(
      acceptedByPath.get('invoice.line[0].quantity') ?? 0,
    );
    const lineUnitValue = Number(
      acceptedByPath.get('invoice.line[0].unitValue') ?? 0,
    );

    const draft = await this.entries.draftFromHandoff({
      brokerOrganizationId: ctx.organizationId,
      clientId: packet.clientId,
      shipmentId: dto.shipmentId ?? packet.shipmentId ?? null,
      packetId: packet.id,
      entryType: dto.entryType ?? 'consumption',
      metadata: { sourcePacketId: packet.id },
      lines: lineDescription
        ? [
            {
              lineNumber: 1,
              description: lineDescription,
              quantity: lineQuantity || undefined,
              unitValue: lineUnitValue || undefined,
              currency: acceptedByPath.get('invoice.currency') ?? undefined,
              countryOfOrigin: acceptedByPath.get('origin.country') ?? undefined,
            },
          ]
        : [],
    });

    packet.status = 'draft_created';
    await this.packets.save(packet);

    await this.audit.record({
      eventType: 'broker_packets.entry.drafted',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_document_packet',
      resourceId: packet.id,
      source: 'broker-packets',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { entryId: draft.id },
    });
    return draft;
  }

  private async storeDocuments(
    ctx: RequestContext,
    packet: BrokerDocumentPacketEntity,
    documents: UploadDocumentDto[],
  ): Promise<void> {
    for (const upload of documents) {
      const buffer = Buffer.from(upload.contentBase64, 'base64');
      const scan = await this.scan.scan({
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        content: buffer,
      });

      // Even for blocked content, we record the row so audit can show what
      // was attempted — but we skip storage write to keep malware off disk.
      let stored: { storageKey: string; sha256: string };
      if (scan.status === 'blocked') {
        const sha256 = createHash('sha256').update(buffer).digest('hex');
        stored = {
          sha256,
          storageKey: `quarantine/${packet.brokerOrganizationId}/${packet.id}/${sha256}`,
        };
      } else {
        const result = await this.storage.store({
          organizationId: packet.brokerOrganizationId,
          ownerUserId: ctx.userId,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          content: buffer,
          purpose: 'broker-packets',
        });
        stored = { storageKey: result.storageKey, sha256: result.sha256 };
      }

      const doc = this.documents.create({
        packetId: packet.id,
        brokerOrganizationId: packet.brokerOrganizationId,
        clientId: packet.clientId,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        byteSize: buffer.byteLength,
        sha256: stored.sha256,
        storageKey: stored.storageKey,
        documentType: 'unknown',
        scanStatus: scan.status,
        scanProvider: scan.provider,
        scanReason: scan.reason ?? null,
      });
      await this.documents.save(doc);

      if (scan.status === 'blocked') {
        await this.audit.record({
          eventType: 'broker_packets.document.blocked',
          organizationId: packet.brokerOrganizationId,
          actorUserId: ctx.userId,
          resourceType: 'broker_document',
          resourceId: doc.id,
          source: 'broker-packets',
          metadata: { reason: scan.reason },
        });
      }
    }
  }

  private async enqueueProcessing(packetId: string): Promise<void> {
    try {
      await this.queue.sendJob(BROKER_PACKET_PROCESS_QUEUE, { packetId });
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue packet ${packetId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private async requireOwned(ctx: RequestContext, id: string) {
    this.assertAuthenticated(ctx);
    const packet = await this.packets.findOne({ where: { id } });
    if (!packet) throw new NotFoundException('Packet not found');
    if (packet.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Packet belongs to another tenant');
    }
    return packet;
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }

  /**
   * R1-E-03 — resolve the reconciliation tolerance to apply for this packet's
   * client. Falls through to the env default when the client row is missing
   * or has no override.
   */
  private async resolveTolerance(
    clientId: string | null,
  ): Promise<number | undefined> {
    const envDefault = Number(
      process.env.BROKER_RECONCILIATION_DEFAULT_TOLERANCE ?? 1,
    );
    if (!clientId) return envDefault;
    const client = await this.brokerClients.findOne({
      where: { id: clientId },
    });
    if (!client?.reconciliationTolerancePct) return envDefault;
    const pct = Number(client.reconciliationTolerancePct);
    return Number.isFinite(pct) ? pct : envDefault;
  }
}
