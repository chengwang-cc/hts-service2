import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { BrokerRulesService } from '../../broker-rules/services/broker-rules.service';
import {
  CreateEntryDto,
  EntryLineInputDto,
  ListEntriesDto,
  UpdateEntryDto,
  UpsertEntryLineDto,
} from '../dto/broker-entries.dto';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../entities';

export interface DraftEntryFromHandoffInput {
  brokerOrganizationId: string;
  clientId: string;
  shipmentId?: string | null;
  packetId?: string | null;
  entryType?: BrokerEntryEntity['entryType'];
  dueAt?: Date | null;
  lines?: EntryLineInputDto[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class BrokerEntriesService {
  constructor(
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    @InjectRepository(BrokerEntryLineEntity)
    private readonly lines: Repository<BrokerEntryLineEntity>,
    private readonly audit: AuditService,
    @Optional()
    @Inject(forwardRef(() => BrokerRulesService))
    private readonly rules: BrokerRulesService | null = null,
  ) {}

  async list(ctx: RequestContext, dto: ListEntriesDto) {
    this.assertAuthenticated(ctx);
    const limit = dto.limit ?? 25;
    const offset = dto.offset ?? 0;

    const qb = this.entries
      .createQueryBuilder('entry')
      .leftJoinAndSelect('entry.shipment', 'shipment')
      .where('entry.brokerOrganizationId = :orgId', {
        orgId: ctx.organizationId,
      });

    if (dto.clientId) {
      qb.andWhere('entry.clientId = :clientId', { clientId: dto.clientId });
    }
    if (dto.status) {
      const statuses = dto.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length) {
        qb.andWhere('entry.status IN (:...statuses)', { statuses });
      }
    }
    if (dto.riskLevel) {
      qb.andWhere('entry.riskLevel = :risk', { risk: dto.riskLevel });
    }
    if (dto.assigneeUserId) {
      qb.andWhere('entry.assigneeUserId = :assignee', {
        assignee: dto.assigneeUserId,
      });
    }
    if (dto.q?.trim()) {
      qb.andWhere(
        '(entry.entryNumber ILIKE :q OR entry.internalNotes ILIKE :q)',
        { q: `%${dto.q.trim()}%` },
      );
    }

    qb.orderBy('entry.dueAt', 'ASC')
      .addOrderBy('entry.updatedAt', 'DESC')
      .take(limit)
      .skip(offset);

    const [rows, total] = await qb.getManyAndCount();
    return { rows, total, limit, offset };
  }

  async getDetail(ctx: RequestContext, id: string) {
    const entry = await this.requireOwned(ctx, id);
    const lines = await this.lines.find({
      where: { entryId: id },
      order: { lineNumber: 'ASC' },
    });
    return { ...entry, lines };
  }

  async create(ctx: RequestContext, dto: CreateEntryDto) {
    this.assertAuthenticated(ctx);
    const entry = this.entries.create({
      brokerOrganizationId: ctx.organizationId,
      clientId: dto.clientId,
      shipmentId: dto.shipmentId ?? null,
      packetId: dto.packetId ?? null,
      entryNumber: dto.entryNumber ?? null,
      entryType: dto.entryType ?? 'consumption',
      status: 'draft',
      riskLevel: 'medium',
      assigneeUserId: dto.assigneeUserId ?? ctx.userId,
      dueAt: dto.dueAt ?? null,
      currency: dto.currency ?? null,
      internalNotes: dto.internalNotes ?? null,
    });
    const saved = await this.entries.save(entry);

    if (dto.lines?.length) {
      const lineEntities = dto.lines.map((line) =>
        this.lines.create({
          entryId: saved.id,
          lineNumber: line.lineNumber,
          sku: line.sku ?? null,
          description: line.description ?? null,
          htsNumber: line.htsNumber ?? null,
          countryOfOrigin: line.countryOfOrigin ?? null,
          quantity: line.quantity != null ? String(line.quantity) : null,
          unitOfMeasure: line.unitOfMeasure ?? null,
          unitValue: line.unitValue != null ? String(line.unitValue) : null,
          currency: line.currency ?? dto.currency ?? null,
          totalValue:
            line.unitValue != null && line.quantity != null
              ? String(line.unitValue * line.quantity)
              : null,
          metadata: line.metadata ?? null,
        }),
      );
      await this.lines.save(lineEntities);
      saved.totalValue = this.sumStringNumbers(
        lineEntities.map((l) => l.totalValue),
      );
      await this.entries.save(saved);
    }

    await this.audit.record({
      eventType: 'broker_entries.entry.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_entry',
      resourceId: saved.id,
      source: 'broker-entries',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { entryType: saved.entryType },
    });

    return this.getDetail(ctx, saved.id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateEntryDto) {
    let entry = await this.requireOwned(ctx, id);

    // R1-C-01 — re-run validation before approving so the approve button
    // can't latch onto a stale `blockers` snapshot. We refresh the entry
    // from disk after validation since validateEntry() may have mutated
    // the row's blockers array.
    if (dto.status === 'approved' && this.rules) {
      await this.rules.validateEntry(ctx, id);
      entry = await this.requireOwned(ctx, id);
    }

    if (dto.status === 'approved' || dto.status === 'exported') {
      if (entry.blockers?.some((b) => b.severity === 'blocker')) {
        throw new BadRequestException(
          'Cannot approve entry with unresolved blockers',
        );
      }
    }

    if (dto.entryNumber !== undefined) entry.entryNumber = dto.entryNumber;
    if (dto.status !== undefined) {
      entry.status = dto.status;
      if (dto.status === 'approved') {
        entry.approvedAt = new Date();
        entry.approvedByUserId = ctx.userId;
      }
      if (dto.status === 'exported') {
        entry.exportedAt = new Date();
      }
    }
    if (dto.riskLevel !== undefined) entry.riskLevel = dto.riskLevel;
    if (dto.assigneeUserId !== undefined) {
      entry.assigneeUserId = dto.assigneeUserId;
    }
    if (dto.dueAt !== undefined) entry.dueAt = dto.dueAt;
    if (dto.internalNotes !== undefined) entry.internalNotes = dto.internalNotes;

    const saved = await this.entries.save(entry);
    await this.audit.record({
      eventType: 'broker_entries.entry.updated',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_entry',
      resourceId: saved.id,
      source: 'broker-entries',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { status: saved.status },
    });
    return this.getDetail(ctx, saved.id);
  }

  async upsertLine(
    ctx: RequestContext,
    entryId: string,
    lineId: string | null,
    dto: UpsertEntryLineDto,
  ) {
    const entry = await this.requireOwned(ctx, entryId);
    const existing = lineId
      ? await this.lines.findOne({ where: { id: lineId, entryId: entry.id } })
      : null;

    const line = this.lines.create({
      ...(existing ?? {}),
      entryId: entry.id,
      lineNumber: dto.lineNumber,
      sku: dto.sku ?? existing?.sku ?? null,
      description: dto.description ?? existing?.description ?? null,
      htsNumber: dto.htsNumber ?? existing?.htsNumber ?? null,
      countryOfOrigin: dto.countryOfOrigin ?? existing?.countryOfOrigin ?? null,
      quantity:
        dto.quantity != null ? String(dto.quantity) : existing?.quantity ?? null,
      unitOfMeasure: dto.unitOfMeasure ?? existing?.unitOfMeasure ?? null,
      unitValue:
        dto.unitValue != null
          ? String(dto.unitValue)
          : existing?.unitValue ?? null,
      currency: dto.currency ?? existing?.currency ?? entry.currency ?? null,
      metadata: dto.metadata ?? existing?.metadata ?? null,
    });

    const quantity = Number(line.quantity ?? 0);
    const unitValue = Number(line.unitValue ?? 0);
    line.totalValue =
      quantity > 0 && unitValue > 0
        ? String(quantity * unitValue)
        : existing?.totalValue ?? null;

    const saved = await this.lines.save(line);

    await this.recomputeEntryTotals(entry);
    await this.audit.record({
      eventType: existing
        ? 'broker_entries.line.updated'
        : 'broker_entries.line.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_entry_line',
      resourceId: saved.id,
      source: 'broker-entries',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { entryId },
    });
    return saved;
  }

  async deleteLine(ctx: RequestContext, entryId: string, lineId: string) {
    const entry = await this.requireOwned(ctx, entryId);
    const line = await this.lines.findOne({
      where: { id: lineId, entryId: entry.id },
    });
    if (!line) throw new NotFoundException('Line not found');
    await this.lines.delete(line.id);
    await this.recomputeEntryTotals(entry);
    await this.audit.record({
      eventType: 'broker_entries.line.deleted',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_entry_line',
      resourceId: line.id,
      source: 'broker-entries',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { entryId },
    });
  }

  async draftFromHandoff(input: DraftEntryFromHandoffInput) {
    const entry = this.entries.create({
      brokerOrganizationId: input.brokerOrganizationId,
      clientId: input.clientId,
      shipmentId: input.shipmentId ?? null,
      packetId: input.packetId ?? null,
      entryType: input.entryType ?? 'consumption',
      status: 'draft',
      riskLevel: 'medium',
      dueAt: input.dueAt ?? null,
      metadata: input.metadata ?? null,
    });
    const saved = await this.entries.save(entry);
    if (input.lines?.length) {
      const lineEntities = input.lines.map((line) =>
        this.lines.create({
          entryId: saved.id,
          lineNumber: line.lineNumber,
          sku: line.sku ?? null,
          description: line.description ?? null,
          htsNumber: line.htsNumber ?? null,
          countryOfOrigin: line.countryOfOrigin ?? null,
          quantity: line.quantity != null ? String(line.quantity) : null,
          unitOfMeasure: line.unitOfMeasure ?? null,
          unitValue: line.unitValue != null ? String(line.unitValue) : null,
          metadata: line.metadata ?? null,
        }),
      );
      await this.lines.save(lineEntities);
    }
    await this.audit.record({
      eventType: 'broker_entries.entry.handoff_drafted',
      organizationId: input.brokerOrganizationId,
      resourceType: 'broker_entry',
      resourceId: saved.id,
      source: 'broker-entries',
    });
    return saved;
  }

  /**
   * R1-B-01 — cancel the draft entry that was created during accept-quote
   * handoff. We only cancel drafts that are still in `draft` state and that
   * carry the matching marketplaceQuoteId in metadata — once the broker has
   * advanced the entry past draft we leave it alone (manual recovery).
   * Returns true if a draft was cancelled.
   */
  async cancelHandoffDraft(input: {
    brokerOrganizationId: string;
    marketplaceQuoteId: string;
    reason: string;
  }): Promise<boolean> {
    const candidates = await this.entries.find({
      where: {
        brokerOrganizationId: input.brokerOrganizationId,
        status: 'draft',
      },
    });
    const draft = candidates.find(
      (entry) =>
        (entry.metadata as Record<string, unknown> | null)
          ?.marketplaceQuoteId === input.marketplaceQuoteId,
    );
    if (!draft) return false;
    draft.status = 'cancelled';
    draft.metadata = {
      ...(draft.metadata ?? {}),
      cancelReason: input.reason,
      cancelledAt: new Date().toISOString(),
    };
    await this.entries.save(draft);
    await this.audit.record({
      eventType: 'broker_entries.entry.handoff_cancelled',
      organizationId: input.brokerOrganizationId,
      resourceType: 'broker_entry',
      resourceId: draft.id,
      source: 'broker-entries',
      metadata: {
        reason: input.reason,
        marketplaceQuoteId: input.marketplaceQuoteId,
      },
    });
    return true;
  }

  async listByPacket(ctx: RequestContext, packetIds: string[]) {
    if (!packetIds.length) return [];
    return this.entries.find({
      where: {
        brokerOrganizationId: ctx.organizationId,
        packetId: In(packetIds),
      },
    });
  }

  private async recomputeEntryTotals(entry: BrokerEntryEntity) {
    const lines = await this.lines.find({ where: { entryId: entry.id } });
    entry.totalValue = this.sumStringNumbers(lines.map((l) => l.totalValue));
    entry.totalDuty = this.sumStringNumbers(
      lines.map((l) => l.estimatedDuty ?? null),
    );
    await this.entries.save(entry);
  }

  private sumStringNumbers(values: (string | null)[]): string | null {
    let total = 0;
    let hasValue = false;
    for (const value of values) {
      if (value != null) {
        const n = Number(value);
        if (!Number.isNaN(n)) {
          total += n;
          hasValue = true;
        }
      }
    }
    return hasValue ? total.toFixed(4) : null;
  }

  private async requireOwned(ctx: RequestContext, id: string) {
    this.assertAuthenticated(ctx);
    const entry = await this.entries.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Entry belongs to another tenant');
    }
    return entry;
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }
}
