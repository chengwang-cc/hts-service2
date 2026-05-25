import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { BrokerEntryEntity } from '../../broker-entries/entities/broker-entry.entity';
import { BrokerEntryLineEntity } from '../../broker-entries/entities/broker-entry-line.entity';
import { BrokerStatusService } from '../../broker-tasks/services/broker-status.service';
import { EncryptedSecretService } from '../../security/encrypted-secret.service';
import {
  AdapterContext,
  BrokerExportAdapter,
} from '../adapters/adapter.contract';
import { CargoWiseAdapter } from '../adapters/cargowise.adapter';
import { DescartesAdapter } from '../adapters/descartes.adapter';
import { GenericCsvAdapter } from '../adapters/generic-csv.adapter';
import { JsonWebhookAdapter } from '../adapters/json-webhook.adapter';
import { MagayaAcelynkAdapter } from '../adapters/magaya-acelynk.adapter';
import { ProviderProfileAdapter } from '../adapters/provider-profile.adapter';
import { SftpCsvAdapter } from '../adapters/sftp-csv.adapter';
import {
  CreateAdapterDto,
  CreateExportJobDto,
  ImportStatusMessageDto,
  UpdateAdapterDto,
} from '../dto/broker-adapters.dto';
import {
  BrokerAdapterEntity,
  BrokerExportJobEntity,
  BrokerStatusMessageEntity,
} from '../entities';

@Injectable()
export class BrokerAdaptersService {
  private readonly logger = new Logger(BrokerAdaptersService.name);
  private readonly registry: Map<
    BrokerAdapterEntity['adapterType'],
    BrokerExportAdapter
  >;

  constructor(
    @InjectRepository(BrokerAdapterEntity)
    private readonly adapters: Repository<BrokerAdapterEntity>,
    @InjectRepository(BrokerExportJobEntity)
    private readonly jobs: Repository<BrokerExportJobEntity>,
    @InjectRepository(BrokerStatusMessageEntity)
    private readonly statusMessages: Repository<BrokerStatusMessageEntity>,
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    @InjectRepository(BrokerEntryLineEntity)
    private readonly lines: Repository<BrokerEntryLineEntity>,
    private readonly secrets: EncryptedSecretService,
    private readonly statusService: BrokerStatusService,
    private readonly audit: AuditService,
    csvAdapter: GenericCsvAdapter,
    webhookAdapter: JsonWebhookAdapter,
    providerAdapter: ProviderProfileAdapter,
    sftpAdapter: SftpCsvAdapter,
    magayaAdapter: MagayaAcelynkAdapter,
    descartesAdapter: DescartesAdapter,
    cargowiseAdapter: CargoWiseAdapter,
  ) {
    this.registry = new Map();
    this.registry.set(csvAdapter.key, csvAdapter);
    this.registry.set(webhookAdapter.key, webhookAdapter);
    // R2-C-01..03 — dedicated vendor adapters per provider. Each falls back
    // to the provider-profile mapping for the build path, then performs
    // vendor-specific HTTP delivery with the right auth + retry shape.
    // Deploys that haven't been vendor-validated yet can override
    // ADAPTER_PROVIDER_FALLBACK=profile to route through the generic
    // provider-profile adapter (returns artifact + delivered:true without
    // contacting the vendor) — useful during the discovery phase.
    const fallbackToProfile =
      (process.env.ADAPTER_PROVIDER_FALLBACK ?? '').toLowerCase() === 'profile';
    this.registry.set(
      'magaya_acelynk',
      fallbackToProfile ? providerAdapter : magayaAdapter,
    );
    this.registry.set(
      'descartes',
      fallbackToProfile ? providerAdapter : descartesAdapter,
    );
    this.registry.set(
      'cargowise',
      fallbackToProfile ? providerAdapter : cargowiseAdapter,
    );
    this.registry.set(sftpAdapter.key, sftpAdapter);
  }

  async listAdapters(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    return this.adapters.find({
      where: { organizationId: ctx.organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async createAdapter(ctx: RequestContext, dto: CreateAdapterDto) {
    this.assertAuthenticated(ctx);
    if (dto.adapterType === 'catair_edi') {
      throw new BadRequestException(
        'CATAIR EDI is not yet supported. Use the feasibility report endpoint to gap-analyze first.',
      );
    }
    const entity = this.adapters.create({
      organizationId: ctx.organizationId,
      adapterType: dto.adapterType,
      label: dto.label,
      status: dto.enabled === false ? 'disabled' : 'active',
      publicConfig: dto.publicConfig ?? null,
      fieldMappingProfile: dto.fieldMappingProfile ?? null,
      encryptedConfig: dto.secrets
        ? this.secrets.encrypt(JSON.stringify(dto.secrets))
        : null,
    });
    const saved = await this.adapters.save(entity);
    await this.audit.record({
      eventType: 'broker_adapters.adapter.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_adapter',
      resourceId: saved.id,
      source: 'broker-adapters',
      metadata: { adapterType: saved.adapterType },
    });
    return this.toAdapterResponse(saved);
  }

  async updateAdapter(
    ctx: RequestContext,
    id: string,
    dto: UpdateAdapterDto,
  ) {
    const adapter = await this.requireOwnedAdapter(ctx, id);
    if (dto.label != null) adapter.label = dto.label;
    if (dto.publicConfig !== undefined) adapter.publicConfig = dto.publicConfig;
    if (dto.fieldMappingProfile !== undefined) {
      adapter.fieldMappingProfile = dto.fieldMappingProfile;
    }
    if (dto.secrets !== undefined) {
      adapter.encryptedConfig = dto.secrets
        ? this.secrets.encrypt(JSON.stringify(dto.secrets))
        : null;
    }
    if (dto.enabled !== undefined) {
      adapter.status = dto.enabled ? 'active' : 'disabled';
    }
    const saved = await this.adapters.save(adapter);
    await this.audit.record({
      eventType: 'broker_adapters.adapter.updated',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_adapter',
      resourceId: saved.id,
      source: 'broker-adapters',
    });
    return this.toAdapterResponse(saved);
  }

  async testAdapter(ctx: RequestContext, id: string) {
    const adapter = await this.requireOwnedAdapter(ctx, id);
    const handler = this.registry.get(adapter.adapterType);
    if (!handler) {
      throw new BadRequestException(
        `No registry handler for adapter type ${adapter.adapterType}`,
      );
    }

    const fakeEntry = this.entries.create({
      id: '00000000-0000-0000-0000-000000000000',
      brokerOrganizationId: ctx.organizationId,
      clientId: '00000000-0000-0000-0000-000000000000',
      entryNumber: 'TEST-0001',
      entryType: 'consumption',
      status: 'approved',
      riskLevel: 'low',
      assigneeUserId: ctx.userId,
      dueAt: null,
      approvedAt: new Date(),
      approvedByUserId: ctx.userId,
      exportedAt: null,
      currency: 'USD',
      totalValue: '1234.50',
      totalDuty: '0',
      blockers: [],
      metadata: { test: true },
      internalNotes: 'Adapter test entry — not persisted',
    } as Partial<BrokerEntryEntity>);
    const fakeLines = [
      this.lines.create({
        id: '00000000-0000-0000-0000-000000000001',
        entryId: fakeEntry.id,
        lineNumber: 1,
        sku: 'TEST-SKU',
        description: 'Adapter test line',
        htsNumber: '6109.10.00',
        countryOfOrigin: 'VN',
        quantity: '10',
        unitOfMeasure: 'EA',
        unitValue: '123.45',
        currency: 'USD',
        totalValue: '1234.50',
      } as Partial<BrokerEntryLineEntity>),
    ];

    let testStatus: 'ok' | 'failed' = 'failed';
    let message = '';
    try {
      const artifact = await handler.build({
        adapter,
        entry: fakeEntry,
        lines: fakeLines,
        decryptedSecrets: this.decryptSecrets(adapter),
      });
      testStatus = 'ok';
      message = `Built test artifact: ${artifact.fileName} (${artifact.body.byteLength} bytes)`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Unknown test failure';
    }

    adapter.lastTestedAt = new Date();
    adapter.lastTestStatus = testStatus;
    adapter.lastTestMessage = message;
    await this.adapters.save(adapter);
    await this.audit.record({
      eventType: 'broker_adapters.adapter.tested',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_adapter',
      resourceId: adapter.id,
      source: 'broker-adapters',
      metadata: { status: testStatus, message },
    });
    return { status: testStatus, message };
  }

  async createExportJob(ctx: RequestContext, dto: CreateExportJobDto) {
    this.assertAuthenticated(ctx);
    const entry = await this.entries.findOne({ where: { id: dto.entryId } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Entry belongs to another tenant');
    }
    if (entry.status !== 'approved' && entry.status !== 'exported') {
      throw new BadRequestException(
        'Entry must be approved before export. Run validate and approve first.',
      );
    }
    if (entry.blockers?.some((b) => b.severity === 'blocker')) {
      throw new BadRequestException(
        'Cannot export an entry with unresolved blockers',
      );
    }
    const adapter = await this.requireOwnedAdapter(ctx, dto.adapterId);
    if (adapter.status !== 'active') {
      throw new BadRequestException('Adapter is not active');
    }
    const handler = this.registry.get(adapter.adapterType);
    if (!handler) {
      throw new BadRequestException(
        `No registry handler for adapter type ${adapter.adapterType}`,
      );
    }

    const lines = await this.lines.find({ where: { entryId: entry.id } });

    let job = this.jobs.create({
      organizationId: ctx.organizationId,
      entryId: entry.id,
      adapterId: adapter.id,
      format:
        adapter.adapterType === 'generic_csv'
          ? 'generic_csv'
          : adapter.adapterType === 'json_webhook'
            ? 'json_webhook'
            : 'provider_specific',
      status: 'building',
      triggeredByUserId: ctx.userId,
      validationManifest: {
        issuesAtExport: entry.blockers?.length ?? 0,
        blockersAtExport: 0,
        approvedByUserId: entry.approvedByUserId ?? undefined,
        approvedAt: entry.approvedAt?.toISOString(),
      },
    });
    job = await this.jobs.save(job);

    try {
      const ctxA: AdapterContext = {
        adapter,
        entry,
        lines,
        decryptedSecrets: this.decryptSecrets(adapter),
      };
      const artifact = await handler.build(ctxA);
      const sha256 = createHash('sha256').update(artifact.body).digest('hex');
      job.artifactStorageKey = `broker-exports/${adapter.organizationId}/${job.id}/${artifact.fileName}`;
      job.artifactByteSize = artifact.body.byteLength;
      job.artifactSha256 = sha256;
      job.requestSummary = { fileName: artifact.fileName, contentType: artifact.contentType };

      if (handler.deliver) {
        const delivery = await handler.deliver(ctxA, artifact);
        job.status = delivery.delivered ? 'delivered' : 'failed';
        job.requestSummary = { ...(job.requestSummary ?? {}), ...(delivery.requestSummary ?? {}) };
        job.responseSummary = delivery.responseSummary ?? null;
        job.errorMessage = delivery.error ?? null;
      } else {
        job.status = 'delivered';
      }
      if (job.status === 'delivered') {
        job.deliveredAt = new Date();
        entry.status = 'exported';
        entry.exportedAt = job.deliveredAt;
        await this.entries.save(entry);
        await this.statusService.record({
          brokerOrganizationId: ctx.organizationId,
          entryId: entry.id,
          eventType: 'entry.exported',
          headline: `Entry exported via ${adapter.label}`,
          severity: 'success',
          metadata: { exportJobId: job.id, adapterType: adapter.adapterType },
        });
      }
    } catch (error) {
      job.status = 'failed';
      job.errorMessage =
        error instanceof Error ? error.message : 'Unknown export failure';
      this.logger.error(`Export job ${job.id} failed: ${job.errorMessage}`);
    }

    job = await this.jobs.save(job);
    await this.audit.record({
      eventType: 'broker_adapters.export.completed',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_export_job',
      resourceId: job.id,
      source: 'broker-adapters',
      metadata: {
        entryId: entry.id,
        adapterType: adapter.adapterType,
        status: job.status,
      },
    });
    return job;
  }

  async listJobs(ctx: RequestContext, entryId?: string) {
    this.assertAuthenticated(ctx);
    return this.jobs.find({
      where: {
        organizationId: ctx.organizationId,
        ...(entryId ? { entryId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async importStatusMessage(
    ctx: RequestContext,
    dto: ImportStatusMessageDto,
  ) {
    this.assertAuthenticated(ctx);
    const entry = await this.entries.findOne({ where: { id: dto.entryId } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Entry belongs to another tenant');
    }
    const message = this.statusMessages.create({
      organizationId: ctx.organizationId,
      entryId: entry.id,
      source: dto.source,
      messageType: dto.messageType,
      severity: dto.severity ?? 'info',
      normalizedStatus: dto.normalizedStatus ?? null,
      rawMessage: dto.rawMessage,
    });
    const saved = await this.statusMessages.save(message);

    await this.statusService.record({
      brokerOrganizationId: ctx.organizationId,
      entryId: entry.id,
      eventType: `status_import.${dto.messageType}`,
      headline: dto.normalizedStatus ?? dto.messageType,
      severity: dto.severity ?? 'info',
      metadata: { source: dto.source, statusMessageId: saved.id },
    });

    if (dto.normalizedStatus === 'rejected') {
      entry.status = 'rejected';
      await this.entries.save(entry);
    } else if (
      dto.normalizedStatus === 'accepted' ||
      dto.normalizedStatus === 'cleared'
    ) {
      entry.status = 'accepted';
      await this.entries.save(entry);
    } else if (
      dto.normalizedStatus === 'transmitted' &&
      entry.status === 'exported'
    ) {
      entry.status = 'transmitted';
      await this.entries.save(entry);
    }

    return saved;
  }

  async listStatusMessages(ctx: RequestContext, entryId: string) {
    this.assertAuthenticated(ctx);
    return this.statusMessages.find({
      where: { organizationId: ctx.organizationId, entryId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Returns a structured CATAIR feasibility gap report so the team can decide
   * whether to invest in real EDI before promising it. The plan requires no
   * CATAIR build until mapping and tests exist.
   */
  catairFeasibilityReport() {
    return {
      status: 'gap_report_only',
      summary:
        'CATAIR (ACE EDI) is not implemented. This report enumerates the gaps and prerequisites before any CATAIR adapter can ship.',
      prerequisites: [
        'Approved filer code and broker license registered with CBP',
        'Production ACE/CATAIR connection and test environment access',
        'Vendor-validated EDI translator (or in-house CATAIR builder)',
        'Field mapping spec from internal entry model to CATAIR EI/SE/AE/AX records',
        'Golden test set covering at minimum: ISF, Entry Summary, Cargo Release, PGA disclaimer, FTZ admit',
        'Bond and POA verification flow tied to licensed broker approver',
      ],
      missingArtifacts: [
        'docs/adapters/catair-mapping.md (per-record-type field mapping)',
        'test fixtures matching CBP CATAIR validation schemas',
        'integration tests against CBP ACE test environment',
      ],
      currentCapability: {
        genericCsv: true,
        jsonWebhook: true,
        providerProfile: true,
        magayaAcelynk: 'shipped-untested-against-vendor-sandbox',
        descartes: 'shipped-untested-against-vendor-sandbox',
        cargowise: 'shipped-untested-against-vendor-sandbox',
        sftpCsv: true,
        catairEdi: false,
        cbpDirectAbi: false,
      },
      recommendation:
        'Continue using generic CSV / JSON webhook / provider-profile adapters until prerequisites are met. Do not market HTS as CATAIR-compliant.',
    };
  }

  private async requireOwnedAdapter(ctx: RequestContext, id: string) {
    this.assertAuthenticated(ctx);
    const adapter = await this.adapters.findOne({ where: { id } });
    if (!adapter) throw new NotFoundException('Adapter not found');
    if (adapter.organizationId !== ctx.organizationId) {
      throw new ForbiddenException('Adapter belongs to another tenant');
    }
    return adapter;
  }

  private decryptSecrets(
    adapter: BrokerAdapterEntity,
  ): Record<string, string> | undefined {
    if (!adapter.encryptedConfig) return undefined;
    try {
      return JSON.parse(this.secrets.decrypt(adapter.encryptedConfig));
    } catch (err) {
      this.logger.warn(
        `Failed to decrypt secrets for adapter ${adapter.id}: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private toAdapterResponse(adapter: BrokerAdapterEntity) {
    return {
      id: adapter.id,
      organizationId: adapter.organizationId,
      adapterType: adapter.adapterType,
      label: adapter.label,
      status: adapter.status,
      publicConfig: adapter.publicConfig,
      fieldMappingProfile: adapter.fieldMappingProfile,
      hasSecrets: Boolean(adapter.encryptedConfig),
      lastTestedAt: adapter.lastTestedAt,
      lastTestStatus: adapter.lastTestStatus,
      lastTestMessage: adapter.lastTestMessage,
      createdAt: adapter.createdAt,
      updatedAt: adapter.updatedAt,
    };
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }
}
