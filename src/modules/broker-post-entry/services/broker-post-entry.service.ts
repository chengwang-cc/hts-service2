import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { DocumentStorageService } from '../../documents/document-storage.service';
import { BrokerEntryEntity } from '../../broker-entries/entities/broker-entry.entity';
import { BrokerEntryLineEntity } from '../../broker-entries/entities/broker-entry-line.entity';
import { BrokerExportJobEntity } from '../../broker-adapters/entities/broker-export-job.entity';
import { BrokerStatusMessageEntity } from '../../broker-adapters/entities/broker-status-message.entity';
import {
  BrokerAiSuggestionEntity,
  BrokerDecisionEntity,
} from '../../broker-decisions/entities';
import {
  BrokerDocumentEntity,
  BrokerDocumentPacketEntity,
  BrokerExtractedFieldEntity,
} from '../../broker-packets/entities';
import { BrokerValidationResultEntity } from '../../broker-rules/entities';
import {
  CreateCaseDto,
  SearchPriorDecisionsDto,
  UpdateCaseDto,
} from '../dto/broker-post-entry.dto';
import {
  BrokerAuditPackEntity,
  BrokerPostEntryCaseEntity,
} from '../entities';

@Injectable()
export class BrokerPostEntryService {
  constructor(
    @InjectRepository(BrokerPostEntryCaseEntity)
    private readonly cases: Repository<BrokerPostEntryCaseEntity>,
    @InjectRepository(BrokerAuditPackEntity)
    private readonly auditPacks: Repository<BrokerAuditPackEntity>,
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    @InjectRepository(BrokerEntryLineEntity)
    private readonly lines: Repository<BrokerEntryLineEntity>,
    @InjectRepository(BrokerDocumentPacketEntity)
    private readonly packets: Repository<BrokerDocumentPacketEntity>,
    @InjectRepository(BrokerDocumentEntity)
    private readonly documents: Repository<BrokerDocumentEntity>,
    @InjectRepository(BrokerExtractedFieldEntity)
    private readonly fields: Repository<BrokerExtractedFieldEntity>,
    @InjectRepository(BrokerAiSuggestionEntity)
    private readonly suggestions: Repository<BrokerAiSuggestionEntity>,
    @InjectRepository(BrokerDecisionEntity)
    private readonly decisions: Repository<BrokerDecisionEntity>,
    @InjectRepository(BrokerValidationResultEntity)
    private readonly validationResults: Repository<BrokerValidationResultEntity>,
    @InjectRepository(BrokerExportJobEntity)
    private readonly exportJobs: Repository<BrokerExportJobEntity>,
    @InjectRepository(BrokerStatusMessageEntity)
    private readonly statusMessages: Repository<BrokerStatusMessageEntity>,
    private readonly audit: AuditService,
    @Optional() private readonly storage: DocumentStorageService | null = null,
  ) {}

  private readonly logger = new Logger(BrokerPostEntryService.name);

  async createCase(ctx: RequestContext, dto: CreateCaseDto) {
    this.assertAuthenticated(ctx);
    const entry = await this.entries.findOne({ where: { id: dto.entryId } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Entry belongs to another tenant');
    }
    const entity = this.cases.create({
      brokerOrganizationId: ctx.organizationId,
      entryId: entry.id,
      clientId: entry.clientId,
      caseType: dto.caseType,
      cbpReference: dto.cbpReference ?? null,
      status: 'open',
      description: dto.description ?? null,
      assigneeUserId: dto.assigneeUserId ?? ctx.userId,
      dueAt: dto.dueAt ?? null,
    });
    const saved = await this.cases.save(entity);
    await this.audit.record({
      eventType: 'broker_post_entry.case.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_post_entry_case',
      resourceId: saved.id,
      source: 'broker-post-entry',
      metadata: { caseType: saved.caseType, entryId: entry.id },
    });
    return saved;
  }

  async listCases(
    ctx: RequestContext,
    params: { status?: string; entryId?: string } = {},
  ) {
    this.assertAuthenticated(ctx);
    const qb = this.cases
      .createQueryBuilder('case')
      .where('case.brokerOrganizationId = :orgId', {
        orgId: ctx.organizationId,
      });
    if (params.status) {
      qb.andWhere('case.status = :status', { status: params.status });
    }
    if (params.entryId) {
      qb.andWhere('case.entryId = :entryId', { entryId: params.entryId });
    }
    qb.orderBy('case.dueAt', 'ASC').addOrderBy('case.createdAt', 'DESC').take(
      100,
    );
    return qb.getMany();
  }

  async updateCase(ctx: RequestContext, caseId: string, dto: UpdateCaseDto) {
    const caseEntity = await this.cases.findOne({ where: { id: caseId } });
    if (!caseEntity) throw new NotFoundException('Case not found');
    if (caseEntity.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Case belongs to another tenant');
    }
    if (dto.status !== undefined) {
      caseEntity.status = dto.status;
      if (dto.status === 'resolved') {
        caseEntity.resolvedAt = new Date();
      }
    }
    if (dto.description !== undefined) {
      caseEntity.description = dto.description;
    }
    if (dto.assigneeUserId !== undefined) {
      caseEntity.assigneeUserId = dto.assigneeUserId;
    }
    if (dto.dueAt !== undefined) caseEntity.dueAt = dto.dueAt;
    const saved = await this.cases.save(caseEntity);
    await this.audit.record({
      eventType: 'broker_post_entry.case.updated',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_post_entry_case',
      resourceId: saved.id,
      source: 'broker-post-entry',
      metadata: { status: saved.status },
    });
    return saved;
  }

  async generateAuditPack(ctx: RequestContext, entryId: string) {
    this.assertAuthenticated(ctx);
    const entry = await this.entries.findOne({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Entry belongs to another tenant');
    }

    const [
      lines,
      packets,
      validationIssues,
      suggestions,
      decisions,
      exports,
      statusMessages,
      cases,
    ] = await Promise.all([
      this.lines.find({ where: { entryId } }),
      entry.packetId
        ? this.packets.find({ where: { id: entry.packetId } })
        : Promise.resolve([] as BrokerDocumentPacketEntity[]),
      this.validationResults.find({
        where: { brokerOrganizationId: ctx.organizationId, entryId },
      }),
      this.suggestions.find({
        where: {
          brokerOrganizationId: ctx.organizationId,
          targetType: 'broker_entry_line',
        },
      }),
      this.decisions.find({
        where: {
          brokerOrganizationId: ctx.organizationId,
        },
      }),
      this.exportJobs.find({
        where: { organizationId: ctx.organizationId, entryId },
      }),
      this.statusMessages.find({
        where: { organizationId: ctx.organizationId, entryId },
      }),
      this.cases.find({
        where: { brokerOrganizationId: ctx.organizationId, entryId },
      }),
    ]);

    const lineIds = new Set(lines.map((l) => l.id));
    const documents = entry.packetId
      ? await this.documents.find({ where: { packetId: entry.packetId } })
      : [];
    const fields = entry.packetId
      ? await this.fields.find({ where: { packetId: entry.packetId } })
      : [];
    const relevantSuggestions = suggestions.filter((s) => lineIds.has(s.targetId));
    const relevantDecisions = decisions.filter(
      (d) => lineIds.has(d.targetId) || d.targetId === entry.id,
    );

    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      generatedByUserId: ctx.userId,
      entry: {
        id: entry.id,
        entryNumber: entry.entryNumber,
        entryType: entry.entryType,
        status: entry.status,
        totalValue: entry.totalValue,
        totalDuty: entry.totalDuty,
        approvedAt: entry.approvedAt,
        approvedByUserId: entry.approvedByUserId,
        exportedAt: entry.exportedAt,
      },
      lines: lines.map((l) => ({
        id: l.id,
        lineNumber: l.lineNumber,
        sku: l.sku,
        description: l.description,
        htsNumber: l.htsNumber,
        countryOfOrigin: l.countryOfOrigin,
        quantity: l.quantity,
        unitOfMeasure: l.unitOfMeasure,
        unitValue: l.unitValue,
        totalValue: l.totalValue,
        classificationStatus: l.classificationStatus,
        classificationEvidence: l.classificationEvidence,
        policyFlags: l.policyFlags,
      })),
      packets: packets.map((p) => ({
        id: p.id,
        status: p.status,
        source: p.source,
        receivedAt: p.receivedAt,
        reconciliation: p.reconciliation,
      })),
      documents: documents.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        documentType: d.documentType,
        sha256: d.sha256,
        scanStatus: d.scanStatus,
      })),
      extractedFields: fields.map((f) => ({
        id: f.id,
        fieldPath: f.fieldPath,
        normalizedValue:
          f.acceptedStatus === 'overridden'
            ? f.reviewedValue
            : f.normalizedValue ?? f.rawValue,
        acceptedStatus: f.acceptedStatus,
        confidence: f.confidence,
        sourceModel: f.sourceModel,
      })),
      validationResults: validationIssues.map((v) => ({
        ruleCode: v.ruleCode,
        severity: v.severity,
        status: v.status,
        message: v.message,
        resolvedByUserId: v.resolvedByUserId,
      })),
      aiSuggestions: relevantSuggestions.map((s) => ({
        id: s.id,
        suggestionType: s.suggestionType,
        modelVersion: s.modelVersion,
        confidence: s.confidence,
        status: s.status,
        evidence: s.evidence,
      })),
      brokerDecisions: relevantDecisions.map((d) => ({
        id: d.id,
        suggestionId: d.suggestionId,
        decision: d.decision,
        finalValue: d.finalValue,
        decidedAt: d.decidedAt,
        decidedByUserId: d.decidedByUserId,
        licensedBrokerSatisfied: d.licensedBrokerSatisfied,
        reason: d.reason,
        bulkContext: d.bulkContext,
      })),
      exports: exports.map((e) => ({
        id: e.id,
        adapterId: e.adapterId,
        format: e.format,
        status: e.status,
        artifactSha256: e.artifactSha256,
        artifactByteSize: e.artifactByteSize,
        validationManifest: e.validationManifest,
        deliveredAt: e.deliveredAt,
      })),
      statusMessages: statusMessages.map((s) => ({
        id: s.id,
        source: s.source,
        messageType: s.messageType,
        normalizedStatus: s.normalizedStatus,
        createdAt: s.createdAt,
      })),
      postEntryCases: cases.map((c) => ({
        id: c.id,
        caseType: c.caseType,
        cbpReference: c.cbpReference,
        status: c.status,
        createdAt: c.createdAt,
        resolvedAt: c.resolvedAt,
      })),
    };

    const manifestBody = JSON.stringify(manifest, null, 2);
    const sha256 = createHash('sha256').update(manifestBody).digest('hex');
    const storageKey = `broker-audit-packs/${ctx.organizationId}/${entry.id}/${sha256}.json`;

    const pack = this.auditPacks.create({
      brokerOrganizationId: ctx.organizationId,
      entryId: entry.id,
      format: 'json',
      storageKey,
      sha256,
      byteSize: Buffer.byteLength(manifestBody, 'utf-8'),
      manifest,
      generatedByUserId: ctx.userId,
    });
    const saved = await this.auditPacks.save(pack);

    await this.audit.record({
      eventType: 'broker_post_entry.audit_pack.generated',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_audit_pack',
      resourceId: saved.id,
      source: 'broker-post-entry',
      metadata: { entryId: entry.id, sha256 },
    });
    return saved;
  }

  async getAuditPack(ctx: RequestContext, packId: string) {
    this.assertAuthenticated(ctx);
    const pack = await this.auditPacks.findOne({ where: { id: packId } });
    if (!pack) throw new NotFoundException('Audit pack not found');
    if (pack.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Audit pack belongs to another tenant');
    }
    return pack;
  }

  /**
   * R2-E-01 — render the audit pack manifest into an HTML snapshot and
   * persist as a second audit_pack row with format='html'. A true PDF
   * rendering pass via headless Chromium remains a follow-up; the HTML
   * snapshot is portable, deterministic, and works as a print-to-PDF
   * target in any modern browser.
   */
  async renderAuditPackHtml(
    ctx: RequestContext,
    sourcePackId: string,
  ) {
    const source = await this.getAuditPack(ctx, sourcePackId);
    const html = renderManifestHtml(source.manifest);
    const buffer = Buffer.from(html, 'utf-8');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const storageKey = `broker-audit-packs/${ctx.organizationId}/${source.entryId}/${sha256}.html`;

    if (this.storage) {
      await this.storage
        .store({
          organizationId: ctx.organizationId,
          ownerUserId: ctx.userId,
          fileName: `audit-pack-${source.entryId}.html`,
          mimeType: 'text/html',
          content: buffer,
          purpose: 'broker-audit-packs',
        })
        .catch((err) =>
          this.logger.warn(
            `Audit pack HTML store failed: ${(err as Error).message}`,
          ),
        );
    }

    const pack = this.auditPacks.create({
      brokerOrganizationId: ctx.organizationId,
      entryId: source.entryId,
      format: 'html',
      storageKey,
      sha256,
      byteSize: buffer.byteLength,
      manifest: source.manifest,
      generatedByUserId: ctx.userId,
    });
    const saved = await this.auditPacks.save(pack);
    await this.audit.record({
      eventType: 'broker_post_entry.audit_pack.html_rendered',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_audit_pack',
      resourceId: saved.id,
      source: 'broker-post-entry',
      metadata: { sourcePackId, byteSize: buffer.byteLength },
    });
    return saved;
  }

  /**
   * R2-E-02 — return a short-lived download URL for the audit pack
   * artifact (JSON or HTML). When DocumentStorageService is wired this
   * issues a presigned URL via the configured adapter (S3 or local-disk).
   */
  async getAuditPackDownloadUrl(ctx: RequestContext, packId: string) {
    const pack = await this.getAuditPack(ctx, packId);
    if (!this.storage) {
      throw new BadRequestException(
        'DocumentStorageService is not configured on this deploy',
      );
    }
    if (!pack.storageKey) {
      throw new BadRequestException('Audit pack has no storage key');
    }
    const url = await this.storage.createReadUrl(pack.storageKey, {
      organizationId: ctx.organizationId,
      fileName: pack.format === 'html' ? 'audit-pack.html' : 'audit-pack.json',
      expiresInSeconds: 600,
    });
    return { url, provider: this.storage.providerKey, packId: pack.id };
  }

  /**
   * R2-E-03 — mark a post-entry case overdue + bump escalation. Used by
   * the post-entry timer cron in `BrokerPostEntryTimerWorker`.
   */
  async escalateOverdueCase(caseId: string) {
    const row = await this.cases.findOne({ where: { id: caseId } });
    if (!row) return null;
    const metadata = {
      ...(row.metadata ?? {}),
      escalation: {
        level: Number(
          (row.metadata as Record<string, any> | null)?.escalation?.level ?? 0,
        ) + 1,
        escalatedAt: new Date().toISOString(),
      },
    };
    row.metadata = metadata;
    if (row.status === 'open') row.status = 'in_progress';
    await this.cases.save(row);
    await this.audit.record({
      eventType: 'broker_post_entry.case.escalated',
      organizationId: row.brokerOrganizationId,
      resourceType: 'broker_post_entry_case',
      resourceId: row.id,
      source: 'broker-post-entry-timer',
      metadata: {
        caseType: row.caseType,
        dueAt: row.dueAt,
        escalationLevel: (metadata as any).escalation.level,
      },
    });
    return row;
  }

  /**
   * R2-E-03 — list cases that are past their dueAt and haven't been
   * resolved. Used by the timer cron and surfaced in the workbench
   * "post-entry?status=overdue" view.
   */
  async listOverdueCases(limit = 50) {
    const now = new Date();
    return this.cases
      .createQueryBuilder('c')
      .where('c.status != :resolved', { resolved: 'resolved' })
      .andWhere('c.dueAt IS NOT NULL')
      .andWhere('c.dueAt < :now', { now })
      .orderBy('c.dueAt', 'ASC')
      .take(limit)
      .getMany();
  }

  async listAuditPacksForEntry(ctx: RequestContext, entryId: string) {
    this.assertAuthenticated(ctx);
    return this.auditPacks.find({
      where: { brokerOrganizationId: ctx.organizationId, entryId },
      order: { createdAt: 'DESC' },
    });
  }

  async searchPriorDecisions(
    ctx: RequestContext,
    dto: SearchPriorDecisionsDto,
  ): Promise<
    Array<{
      lineId: string;
      entryId: string;
      entryNumber: string | null;
      entryStatus: string;
      clientId: string;
      approvedAt: Date | null;
      lineNumber: number;
      description: string | null;
      htsNumber: string | null;
      countryOfOrigin: string | null;
      classificationStatus: string;
    }>
  > {
    this.assertAuthenticated(ctx);
    const limit = dto.limit ?? 25;
    const qb = this.lines
      .createQueryBuilder('line')
      .leftJoinAndMapOne(
        'line.entry',
        BrokerEntryEntity,
        'entry',
        'entry.id = line.entryId',
      )
      .where('entry.brokerOrganizationId = :orgId', {
        orgId: ctx.organizationId,
      })
      .orderBy('entry.approvedAt', 'DESC')
      .addOrderBy('entry.updatedAt', 'DESC')
      .take(limit);

    if (dto.hts) {
      qb.andWhere('line.htsNumber ILIKE :hts', { hts: `%${dto.hts}%` });
    }
    if (dto.clientId) {
      qb.andWhere('entry.clientId = :clientId', { clientId: dto.clientId });
    }
    if (dto.description) {
      qb.andWhere('line.description ILIKE :desc', {
        desc: `%${dto.description}%`,
      });
    }
    if (!dto.hts && !dto.clientId && !dto.description) {
      qb.andWhere('line.classificationStatus IN (:...accepted)', {
        accepted: ['human_accepted', 'human_overridden'],
      });
    }

    const rows = await qb.getMany();
    return rows.map((line) => {
      const entry = (line as unknown as { entry?: BrokerEntryEntity }).entry;
      return {
        lineId: line.id,
        entryId: line.entryId,
        entryNumber: entry?.entryNumber ?? null,
        entryStatus: entry?.status ?? '',
        clientId: entry?.clientId ?? '',
        approvedAt: entry?.approvedAt ?? null,
        lineNumber: line.lineNumber,
        description: line.description,
        htsNumber: line.htsNumber,
        countryOfOrigin: line.countryOfOrigin,
        classificationStatus: line.classificationStatus,
      };
    });
  }

  /**
   * Marks entries whose lines reference an HTS prefix as needing post-entry
   * review. The plan calls for tying into the existing policy-change monitor;
   * this method is what that monitor should call.
   */
  async flagEntriesAffectedByPolicyChange(
    htsPrefix: string,
    organizationId?: string,
  ) {
    const qb = this.lines
      .createQueryBuilder('line')
      .innerJoinAndMapOne(
        'line.entryRef',
        BrokerEntryEntity,
        'entry',
        'entry.id = line.entryId',
      )
      .where('line.htsNumber LIKE :prefix', { prefix: `${htsPrefix}%` })
      .andWhere('entry.status IN (:...active)', {
        active: ['approved', 'exported', 'transmitted', 'accepted'],
      });
    if (organizationId) {
      qb.andWhere('entry.brokerOrganizationId = :orgId', {
        orgId: organizationId,
      });
    }
    qb.take(500);
    const lines = await qb.getMany();
    const entryIds = Array.from(new Set(lines.map((l) => l.entryId)));
    if (!entryIds.length) return { created: 0 };

    let created = 0;
    for (const entryId of entryIds) {
      const entry = await this.entries.findOne({ where: { id: entryId } });
      if (!entry) continue;
      const existing = await this.cases.findOne({
        where: {
          brokerOrganizationId: entry.brokerOrganizationId,
          entryId,
          caseType: 'classification_review',
          status: 'open',
        },
      });
      if (existing) continue;
      const newCase = this.cases.create({
        brokerOrganizationId: entry.brokerOrganizationId,
        entryId,
        clientId: entry.clientId,
        caseType: 'classification_review',
        status: 'open',
        description: `Policy change affects HTS prefix ${htsPrefix}; review prior classifications`,
        dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      });
      await this.cases.save(newCase);
      created += 1;
    }
    return { created, entriesAffected: entryIds.length };
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }
}

function renderManifestHtml(manifest: any): string {
  const safe = (s: any) =>
    String(s ?? '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
    );
  const json = JSON.stringify(manifest, null, 2);
  const entry = manifest?.entry ?? {};
  const lines: any[] = manifest?.lines ?? [];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Broker Audit Pack — ${safe(entry.entryNumber ?? entry.id)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 880px; margin: 32px auto; color: #1f2933; padding: 0 16px; }
  h1, h2 { border-bottom: 1px solid #cbd2d9; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px; }
  th, td { border: 1px solid #e4e7eb; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f5f7fa; }
  pre { background: #f5f7fa; padding: 12px; overflow-x: auto; font-size: 11px; }
  .meta { color: #616e7c; font-size: 13px; margin-bottom: 24px; }
</style>
</head>
<body>
  <h1>Broker Audit Pack</h1>
  <p class="meta">Entry ${safe(entry.entryNumber ?? entry.id)} —
     generated ${safe(manifest?.generatedAt ?? '')} —
     version ${safe(manifest?.version ?? '')}</p>

  <h2>Entry</h2>
  <table>
    ${Object.entries(entry).map(([k, v]) =>
      `<tr><th>${safe(k)}</th><td>${safe(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`,
    ).join('')}
  </table>

  <h2>Lines (${lines.length})</h2>
  <table>
    <thead><tr><th>#</th><th>HTS</th><th>Description</th><th>Country</th><th>Qty</th><th>Total</th></tr></thead>
    <tbody>
      ${lines.map((l: any) =>
        `<tr><td>${safe(l.lineNumber)}</td><td>${safe(l.htsNumber)}</td><td>${safe(l.description)}</td><td>${safe(l.countryOfOrigin)}</td><td>${safe(l.quantity)}</td><td>${safe(l.totalValue)}</td></tr>`,
      ).join('')}
    </tbody>
  </table>

  <h2>Full manifest (JSON)</h2>
  <pre>${safe(json)}</pre>
</body>
</html>`;
}
