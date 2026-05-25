import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { BrokerClientRelationshipEntity } from '../../broker-core/entities/broker-client-relationship.entity';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../../broker-entries/entities';
import { BrokerMissingInfoTaskEntity } from '../entities';

export interface MissingInfoDraftResult {
  drafted: number;
  skipped: number;
  draftTaskIds: string[];
}

/**
 * R2-B-04 — turns an entry's blockers into draft missing-info tasks the
 * broker can review and dispatch. Each blocker becomes one
 * `status='open'` task scoped to the entry + the matching line (when the
 * blocker carries one). The broker still has to confirm + send through
 * the standard `createForBroker` flow; the agent never auto-publishes a
 * task to the business org.
 */
@Injectable()
export class MissingInfoAgentService {
  private readonly logger = new Logger(MissingInfoAgentService.name);

  constructor(
    @InjectRepository(BrokerMissingInfoTaskEntity)
    private readonly tasks: Repository<BrokerMissingInfoTaskEntity>,
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    @InjectRepository(BrokerEntryLineEntity)
    private readonly lines: Repository<BrokerEntryLineEntity>,
    @InjectRepository(BrokerClientRelationshipEntity)
    private readonly relationships: Repository<BrokerClientRelationshipEntity>,
    private readonly audit: AuditService,
  ) {}

  async draftFromEntry(
    ctx: RequestContext,
    entryId: string,
  ): Promise<MissingInfoDraftResult> {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
    const entry = await this.entries.findOne({ where: { id: entryId } });
    if (!entry) {
      throw new ForbiddenException('Entry not found');
    }
    if (entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Entry belongs to another tenant');
    }
    const relationship = await this.relationships.findOne({
      where: {
        brokerOrganizationId: entry.brokerOrganizationId,
        clientId: entry.clientId,
      },
    });
    if (!relationship) {
      this.logger.warn(
        `Entry ${entry.id} has no relationship — cannot draft missing-info tasks`,
      );
      return { drafted: 0, skipped: 0, draftTaskIds: [] };
    }
    const lines = await this.lines.find({ where: { entryId } });
    const linesByValidationCode = new Map<string, BrokerEntryLineEntity>();
    for (const line of lines) {
      for (const issue of line.validationIssues ?? []) {
        linesByValidationCode.set(issue.code, line);
      }
    }

    const result: MissingInfoDraftResult = {
      drafted: 0,
      skipped: 0,
      draftTaskIds: [],
    };
    for (const blocker of entry.blockers ?? []) {
      if (blocker.severity !== 'blocker') continue;
      // Dedupe: if a draft already exists in 'open' status for this entry
      // and blocker code we skip rather than spam.
      const existing = await this.tasks.findOne({
        where: {
          brokerOrganizationId: entry.brokerOrganizationId,
          entryId,
          status: 'open' as any,
          fieldPath: blocker.code,
        },
      });
      if (existing) {
        result.skipped += 1;
        continue;
      }
      const matchedLine = linesByValidationCode.get(blocker.code);
      const task = this.tasks.create({
        brokerOrganizationId: entry.brokerOrganizationId,
        businessOrganizationId: relationship.businessOrganizationId,
        relationshipId: relationship.id,
        clientId: relationship.clientId,
        entryId,
        lineId: matchedLine?.id ?? null,
        fieldExtractedId: null,
        fieldPath: blocker.code,
        prompt: `Missing or inconsistent: ${blocker.message}`,
        detail:
          'Auto-drafted by the missing-info agent from a validation blocker. Review and click Send to dispatch to the client.',
        severity: 'blocker',
        createdByUserId: ctx.userId,
        status: 'open' as any,
        dueAt: null,
      });
      const saved = await this.tasks.save(task);
      result.drafted += 1;
      result.draftTaskIds.push(saved.id);
    }
    await this.audit.record({
      eventType: 'broker_tasks.missing_info.drafts_generated',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_entry',
      resourceId: entryId,
      source: 'broker-tasks-agent',
      metadata: {
        drafted: result.drafted,
        skipped: result.skipped,
      },
    });
    return result;
  }
}
