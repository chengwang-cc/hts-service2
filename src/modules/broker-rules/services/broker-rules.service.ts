import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { BrokerClientRelationshipEntity } from '../../broker-core/entities/broker-client-relationship.entity';
import { BrokerDocumentEntity } from '../../broker-packets/entities/broker-document.entity';
import { BrokerEntryEntity } from '../../broker-entries/entities/broker-entry.entity';
import { BrokerEntryLineEntity } from '../../broker-entries/entities/broker-entry-line.entity';
import {
  AcknowledgeIssueDto,
  UpsertRuleDto,
} from '../dto/broker-rules.dto';
import {
  BrokerRuleEntity,
  BrokerValidationResultEntity,
} from '../entities';
import { BrokerRuleEngine } from './broker-rule-engine.service';

@Injectable()
export class BrokerRulesService {
  constructor(
    @InjectRepository(BrokerRuleEntity)
    private readonly rules: Repository<BrokerRuleEntity>,
    @InjectRepository(BrokerValidationResultEntity)
    private readonly results: Repository<BrokerValidationResultEntity>,
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    @InjectRepository(BrokerEntryLineEntity)
    private readonly lines: Repository<BrokerEntryLineEntity>,
    @InjectRepository(BrokerClientRelationshipEntity)
    private readonly relationships: Repository<BrokerClientRelationshipEntity>,
    @InjectRepository(BrokerDocumentEntity)
    private readonly documents: Repository<BrokerDocumentEntity>,
    private readonly engine: BrokerRuleEngine,
    private readonly audit: AuditService,
  ) {}

  async listRules(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    return this.rules.find({
      where: [
        { scope: 'system', organizationId: IsNull() },
        { organizationId: ctx.organizationId },
      ],
      order: { code: 'ASC' },
    });
  }

  async upsertRule(ctx: RequestContext, dto: UpsertRuleDto) {
    this.assertAuthenticated(ctx);
    const existing = await this.rules.findOne({ where: { code: dto.code } });
    if (existing && existing.scope === 'system') {
      throw new ForbiddenException('System rules cannot be modified');
    }
    if (
      existing &&
      existing.organizationId !== null &&
      existing.organizationId !== ctx.organizationId
    ) {
      throw new ForbiddenException('Rule belongs to another tenant');
    }
    const entity = this.rules.create({
      ...(existing ?? {}),
      code: dto.code,
      title: dto.title,
      description: dto.description ?? null,
      scope: dto.scope === 'system' ? 'organization' : dto.scope,
      organizationId: ctx.organizationId,
      clientId: dto.clientId ?? null,
      severity: dto.severity,
      ruleType: dto.ruleType,
      config: dto.config,
      enabled: dto.enabled ?? true,
    });
    const saved = await this.rules.save(entity);
    await this.audit.record({
      eventType: existing
        ? 'broker_rules.rule.updated'
        : 'broker_rules.rule.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_rule',
      resourceId: saved.id,
      source: 'broker-rules',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { code: saved.code },
    });
    return saved;
  }

  async validateEntry(ctx: RequestContext, entryId: string) {
    this.assertAuthenticated(ctx);
    const entry = await this.entries.findOne({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Entry belongs to another tenant');
    }

    const lines = await this.lines.find({ where: { entryId } });
    const allRules = await this.listRules(ctx);
    // Client-scoped rules only fire for entries belonging to that client.
    const rules = allRules.filter(
      (r) =>
        r.scope !== 'client' ||
        r.clientId == null ||
        r.clientId === entry.clientId,
    );
    const relationship = await this.relationships.findOne({
      where: {
        brokerOrganizationId: ctx.organizationId,
        clientId: entry.clientId,
      },
    });
    let documentTypes: string[] = [];
    if (entry.packetId) {
      const docs = await this.documents.find({
        where: { packetId: entry.packetId },
      });
      documentTypes = Array.from(new Set(docs.map((d) => d.documentType)));
    }

    const issues = this.engine.evaluate({
      entry,
      lines,
      rules,
      relationship,
      documentTypesAvailable: documentTypes,
    });

    // Persist results: clear prior 'open' rows, insert new ones
    await this.results.delete({ entryId, status: 'open' });
    const rows = BrokerRuleEngine.toValidationResults(entry, issues);
    if (rows.length) {
      await this.results.save(
        rows.map((r) => this.results.create(r)),
      );
    }

    entry.blockers = BrokerRuleEngine.toEntryBlockers(issues);
    await this.entries.save(entry);

    await this.audit.record({
      eventType: 'broker_rules.entry.validated',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_entry',
      resourceId: entry.id,
      source: 'broker-rules',
      metadata: {
        blockers: entry.blockers?.length ?? 0,
        issues: issues.length,
      },
    });
    return { entry, issues };
  }

  async listResultsForEntry(ctx: RequestContext, entryId: string) {
    this.assertAuthenticated(ctx);
    return this.results.find({
      where: {
        brokerOrganizationId: ctx.organizationId,
        entryId,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async acknowledgeIssue(
    ctx: RequestContext,
    issueId: string,
    dto: AcknowledgeIssueDto,
  ) {
    const issue = await this.results.findOne({ where: { id: issueId } });
    if (!issue) throw new NotFoundException('Issue not found');
    if (issue.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Issue belongs to another tenant');
    }
    issue.status = dto.status;
    if (dto.status === 'resolved' || dto.status === 'suppressed') {
      issue.resolvedByUserId = ctx.userId;
      issue.resolvedAt = new Date();
    }
    const saved = await this.results.save(issue);
    await this.audit.record({
      eventType: 'broker_rules.issue.status_changed',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_validation_result',
      resourceId: saved.id,
      source: 'broker-rules',
      metadata: { status: saved.status, note: dto.note ?? null },
    });
    return saved;
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }
}
