import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { CbpCrossRulingEntity } from '../../admin/entities/cbp-cross-ruling.entity';
import { AuditService } from '../../audit/services/audit.service';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { BrokerEntryEntity } from '../../broker-entries/entities/broker-entry.entity';
import { BrokerEntryLineEntity } from '../../broker-entries/entities/broker-entry-line.entity';
import { SearchService } from '../../lookup/services/search.service';
import {
  BulkDecisionDto,
  ClassifyLineDto,
  CreateSuggestionDto,
  DecideSuggestionDto,
} from '../dto/broker-decisions.dto';
import {
  BrokerAiSuggestionEntity,
  BrokerDecisionEntity,
} from '../entities';

/**
 * Suggestion types that the policy treats as customs business.
 * Acceptance for these requires an authorized licensed broker user
 * (or a role-bound supervisor) on the decision record.
 */
const LICENSED_BROKER_REQUIRED = new Set([
  'hts_classification',
  'origin',
  'value',
  'pga_disclaimer',
  'special_program',
]);

/**
 * R2-A-04 — org-configurable AI control policy. Stored on
 * OrganizationEntity.settings.brokerAiPolicy.
 *
 *   - allowedSuggestionTypes: subset of the global suggestion set the org
 *     wants generated; types not in this list are dropped at creation.
 *   - confidenceThreshold: minimum confidence (0..1) below which suggestions
 *     are auto-suppressed (status = 'rejected' on create).
 *   - licensedApprovalRequiredFor: additional suggestion types beyond the
 *     system-required set that this org requires licensed broker approval on.
 *   - autoAcceptCeiling: if a suggestion has confidence above this and isn't
 *     in licensedApprovalRequired, the workbench may surface a one-click
 *     "auto-accept" button. UI-only; the server still records the decision.
 */
export interface BrokerAiPolicy {
  allowedSuggestionTypes: string[];
  confidenceThreshold: number;
  licensedApprovalRequiredFor: string[];
  autoAcceptCeiling: number;
}

export const DEFAULT_BROKER_AI_POLICY: BrokerAiPolicy = {
  allowedSuggestionTypes: [
    'hts_classification',
    'origin',
    'value',
    'pga_disclaimer',
    'special_program',
    'document_field_fix',
    'missing_info_question',
    'reject_remediation',
  ],
  confidenceThreshold: 0.0,
  licensedApprovalRequiredFor: [],
  autoAcceptCeiling: 0.95,
};

function mergePolicy(
  patch: Partial<BrokerAiPolicy> | undefined,
): BrokerAiPolicy {
  return {
    allowedSuggestionTypes: dedupe(
      patch?.allowedSuggestionTypes?.length
        ? patch.allowedSuggestionTypes
        : DEFAULT_BROKER_AI_POLICY.allowedSuggestionTypes,
    ),
    confidenceThreshold: clamp01(
      patch?.confidenceThreshold ??
        DEFAULT_BROKER_AI_POLICY.confidenceThreshold,
    ),
    licensedApprovalRequiredFor: dedupe(
      patch?.licensedApprovalRequiredFor ??
        DEFAULT_BROKER_AI_POLICY.licensedApprovalRequiredFor,
    ),
    autoAcceptCeiling: clamp01(
      patch?.autoAcceptCeiling ?? DEFAULT_BROKER_AI_POLICY.autoAcceptCeiling,
    ),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

@Injectable()
export class BrokerDecisionsService {
  private readonly logger = new Logger(BrokerDecisionsService.name);

  constructor(
    @InjectRepository(BrokerAiSuggestionEntity)
    private readonly suggestions: Repository<BrokerAiSuggestionEntity>,
    @InjectRepository(BrokerDecisionEntity)
    private readonly decisions: Repository<BrokerDecisionEntity>,
    @InjectRepository(BrokerEntryLineEntity)
    private readonly lines: Repository<BrokerEntryLineEntity>,
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    private readonly search: SearchService,
    private readonly audit: AuditService,
    @Optional()
    @InjectRepository(CbpCrossRulingEntity)
    private readonly rulings: Repository<CbpCrossRulingEntity> | null = null,
    @Optional()
    @InjectRepository(OrganizationEntity)
    private readonly organizations: Repository<OrganizationEntity> | null = null,
  ) {}

  async createSuggestion(ctx: RequestContext, dto: CreateSuggestionDto) {
    this.assertAuthenticated(ctx);
    // R2-A-04 — apply the org's AI control policy. Disallowed types and
    // suggestions below the org's confidence floor are stored as 'rejected'
    // so audit shows the model fired but the org policy filtered it.
    const policy = await this.getAiControlPolicy(ctx);
    const allowed = policy.allowedSuggestionTypes.includes(dto.suggestionType);
    const meetsFloor =
      dto.confidence == null || dto.confidence >= policy.confidenceThreshold;
    const status: BrokerAiSuggestionEntity['status'] =
      !allowed || !meetsFloor ? 'rejected' : 'pending';
    const entity = this.suggestions.create({
      brokerOrganizationId: ctx.organizationId,
      targetType: dto.targetType,
      targetId: dto.targetId,
      suggestionType: dto.suggestionType,
      value: dto.value,
      confidence: dto.confidence != null ? String(dto.confidence) : null,
      modelVersion: dto.modelVersion,
      evidence:
        (dto.evidence as BrokerAiSuggestionEntity['evidence']) ?? null,
      status,
    });
    const saved = await this.suggestions.save(entity);
    await this.audit.record({
      eventType: 'broker_decisions.suggestion.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_ai_suggestion',
      resourceId: saved.id,
      source: 'broker-decisions',
      metadata: {
        suggestionType: saved.suggestionType,
        targetType: saved.targetType,
        targetId: saved.targetId,
      },
    });
    return saved;
  }

  async listForTarget(
    ctx: RequestContext,
    targetType: BrokerAiSuggestionEntity['targetType'],
    targetId: string,
  ) {
    this.assertAuthenticated(ctx);
    const rows = await this.suggestions.find({
      where: {
        brokerOrganizationId: ctx.organizationId,
        targetType,
        targetId,
      },
      order: { createdAt: 'DESC' },
    });
    return rows;
  }

  async decideSuggestion(
    ctx: RequestContext,
    suggestionId: string,
    dto: DecideSuggestionDto,
  ) {
    const suggestion = await this.requireOwnedSuggestion(ctx, suggestionId);
    if (
      suggestion.status !== 'pending' &&
      suggestion.status !== 'superseded'
    ) {
      throw new BadRequestException(
        `Suggestion is already ${suggestion.status}`,
      );
    }

    const requiresLicensed = LICENSED_BROKER_REQUIRED.has(
      suggestion.suggestionType,
    );
    const licensedSatisfied = requiresLicensed
      ? dto.licensedBrokerSatisfied === true
      : false;

    if (requiresLicensed && dto.decision !== 'reject' && !licensedSatisfied) {
      throw new ForbiddenException(
        `Accepting a ${suggestion.suggestionType} suggestion requires a licensed broker approver`,
      );
    }

    const decision = this.decisions.create({
      brokerOrganizationId: ctx.organizationId,
      suggestionId: suggestion.id,
      targetType: suggestion.targetType,
      targetId: suggestion.targetId,
      suggestionType: suggestion.suggestionType,
      decision: dto.decision,
      finalValue:
        dto.decision === 'reject'
          ? null
          : (dto.finalValue ?? suggestion.value) ?? null,
      decidedByUserId: ctx.userId,
      licensedBrokerRequired: requiresLicensed,
      licensedBrokerSatisfied: licensedSatisfied,
      licensedBrokerUserId:
        dto.licensedBrokerUserId ?? (licensedSatisfied ? ctx.userId : null),
      reason: dto.reason ?? null,
    });
    const savedDecision = await this.decisions.save(decision);

    suggestion.status =
      dto.decision === 'accept'
        ? 'accepted'
        : dto.decision === 'reject'
          ? 'rejected'
          : 'overridden';
    suggestion.decisionId = savedDecision.id;
    await this.suggestions.save(suggestion);

    if (
      suggestion.targetType === 'broker_entry_line' &&
      (dto.decision === 'accept' || dto.decision === 'override')
    ) {
      await this.applyDecisionToLine(suggestion, savedDecision);
    }

    await this.audit.record({
      eventType: 'broker_decisions.decision.recorded',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_decision',
      resourceId: savedDecision.id,
      source: 'broker-decisions',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        decision: dto.decision,
        suggestionType: suggestion.suggestionType,
        licensedBrokerRequired: requiresLicensed,
        licensedBrokerSatisfied: licensedSatisfied,
      },
    });

    return { suggestion, decision: savedDecision };
  }

  async bulkDecide(ctx: RequestContext, dto: BulkDecisionDto) {
    this.assertAuthenticated(ctx);
    if (dto.sharedRationale.trim().length < 20) {
      throw new BadRequestException(
        'Bulk approval requires a shared rationale of at least 20 characters',
      );
    }

    const suggestionIds = dto.items.map((i) => i.suggestionId);
    const suggestions = await this.suggestions.find({
      where: suggestionIds.map((id) => ({
        id,
        brokerOrganizationId: ctx.organizationId,
      })),
    });
    if (suggestions.length !== suggestionIds.length) {
      throw new BadRequestException(
        'One or more suggestions are missing or not in your tenant',
      );
    }

    const requiresLicensed = suggestions.some((s) =>
      LICENSED_BROKER_REQUIRED.has(s.suggestionType),
    );
    if (
      requiresLicensed &&
      dto.decision === 'accept' &&
      dto.licensedBrokerSatisfied !== true
    ) {
      throw new ForbiddenException(
        'Bulk accept of licensed-broker suggestions requires licensedBrokerSatisfied=true',
      );
    }

    const bulkActionId = randomUUID();
    const results: BrokerDecisionEntity[] = [];
    for (const item of dto.items) {
      const suggestion = suggestions.find((s) => s.id === item.suggestionId);
      if (!suggestion) continue;
      if (suggestion.status !== 'pending') continue;

      const decision = this.decisions.create({
        brokerOrganizationId: ctx.organizationId,
        suggestionId: suggestion.id,
        targetType: suggestion.targetType,
        targetId: suggestion.targetId,
        suggestionType: suggestion.suggestionType,
        decision: dto.decision,
        finalValue:
          dto.decision === 'reject'
            ? null
            : (item.finalValue ?? suggestion.value) ?? null,
        decidedByUserId: ctx.userId,
        licensedBrokerRequired: LICENSED_BROKER_REQUIRED.has(
          suggestion.suggestionType,
        ),
        licensedBrokerSatisfied:
          LICENSED_BROKER_REQUIRED.has(suggestion.suggestionType) &&
          dto.licensedBrokerSatisfied === true,
        licensedBrokerUserId: dto.licensedBrokerUserId ?? ctx.userId,
        reason: dto.sharedRationale,
        bulkContext: {
          bulkActionId,
          sharedRationale: dto.sharedRationale,
          affectedTargetCount: dto.items.length,
        },
      });
      const saved = await this.decisions.save(decision);
      results.push(saved);

      suggestion.status =
        dto.decision === 'accept' ? 'accepted' : 'rejected';
      suggestion.decisionId = saved.id;
      await this.suggestions.save(suggestion);

      if (
        suggestion.targetType === 'broker_entry_line' &&
        dto.decision === 'accept'
      ) {
        await this.applyDecisionToLine(suggestion, saved);
      }
    }

    await this.audit.record({
      eventType: 'broker_decisions.bulk_decided',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'broker_decision_bulk',
      resourceId: bulkActionId,
      source: 'broker-decisions',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        count: results.length,
        decision: dto.decision,
        sharedRationale: dto.sharedRationale,
      },
    });

    return { bulkActionId, count: results.length, decisions: results };
  }

  async classifyLine(
    ctx: RequestContext,
    entryId: string,
    lineId: string,
    dto: ClassifyLineDto,
  ) {
    this.assertAuthenticated(ctx);
    const line = await this.lines.findOne({
      where: { id: lineId, entryId },
    });
    if (!line) throw new NotFoundException('Line not found');
    const entry = await this.entries.findOne({ where: { id: entryId } });
    if (!entry || entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Entry belongs to another tenant');
    }

    const candidates = await this.search
      .hybridSearch(dto.description, 5)
      .catch((err) => {
        this.logger.warn(`hybridSearch failed: ${err.message}`);
        return [] as Array<{
          htsNumber?: string;
          score?: number;
          description?: string;
        }>;
      });

    const alternatives = candidates.slice(1).map((c) => ({
      hts: c.htsNumber ?? '',
      confidence: Number(c.score ?? 0),
      reason: c.description ?? '',
    }));

    const recommended = candidates[0];
    if (!recommended?.htsNumber) {
      return {
        suggestionId: null,
        message: 'No HTS candidates returned for description',
      };
    }

    const suggestion = await this.createSuggestion(ctx, {
      targetType: 'broker_entry_line',
      targetId: line.id,
      suggestionType: 'hts_classification',
      value: {
        htsNumber: recommended.htsNumber,
        destinationCountry: dto.destinationCountry ?? 'US',
      },
      confidence: Number(recommended.score ?? 0),
      modelVersion: 'hts-hybrid-search@v1',
      evidence: {
        rationale: recommended.description ?? '',
        alternativesRejected: alternatives.map((alt) => ({
          value: { hts: alt.hts },
          reason: alt.reason,
        })),
        inputs: { description: dto.description },
      },
    });

    line.classificationStatus = 'ai_suggested';
    line.classificationEvidence = {
      suggestedHts: recommended.htsNumber,
      suggestedConfidence: Number(recommended.score ?? 0),
      alternatives,
      notes: recommended.description ?? null,
    };
    await this.lines.save(line);

    return { suggestionId: suggestion.id, recommended, alternatives };
  }

  /**
   * Plan-alias entry point: derive entry id from the line, then defer to
   * classifyLine.
   */
  async classifyLineById(
    ctx: RequestContext,
    lineId: string,
    dto: ClassifyLineDto,
  ) {
    this.assertAuthenticated(ctx);
    const line = await this.lines.findOne({ where: { id: lineId } });
    if (!line) throw new NotFoundException('Line not found');
    return this.classifyLine(ctx, line.entryId, lineId, dto);
  }

  /**
   * Plan-alias entry point: POST /broker/lines/:id/decision. Validates the
   * line and the suggestion both belong to the caller's tenant, then defers
   * to decideSuggestion.
   */
  async lineDecision(
    ctx: RequestContext,
    lineId: string,
    body: {
      suggestionId: string;
      decision: 'accept' | 'reject' | 'override';
      finalValue?: Record<string, unknown>;
      reason?: string;
      licensedBrokerSatisfied?: boolean;
      licensedBrokerUserId?: string | null;
    },
  ) {
    this.assertAuthenticated(ctx);
    if (!body.suggestionId) {
      throw new BadRequestException('suggestionId is required');
    }
    const line = await this.lines.findOne({ where: { id: lineId } });
    if (!line) throw new NotFoundException('Line not found');
    const entry = await this.entries.findOne({ where: { id: line.entryId } });
    if (!entry || entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Line belongs to another tenant');
    }
    const suggestion = await this.suggestions.findOne({
      where: { id: body.suggestionId },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found');
    if (suggestion.targetId !== lineId) {
      throw new BadRequestException(
        'Suggestion does not target the given line',
      );
    }
    return this.decideSuggestion(ctx, body.suggestionId, {
      decision: body.decision,
      finalValue: body.finalValue,
      reason: body.reason,
      licensedBrokerSatisfied: body.licensedBrokerSatisfied,
      licensedBrokerUserId: body.licensedBrokerUserId,
    });
  }

  async listEvidenceForLine(ctx: RequestContext, lineId: string) {
    this.assertAuthenticated(ctx);
    const line = await this.lines.findOne({ where: { id: lineId } });
    if (!line) throw new NotFoundException('Line not found');
    const entry = await this.entries.findOne({ where: { id: line.entryId } });
    if (!entry || entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Line belongs to another tenant');
    }
    const suggestions = await this.suggestions.find({
      where: {
        brokerOrganizationId: ctx.organizationId,
        targetType: 'broker_entry_line',
        targetId: line.id,
      },
      order: { createdAt: 'DESC' },
    });
    const decisions = await this.decisions.find({
      where: {
        brokerOrganizationId: ctx.organizationId,
        targetType: 'broker_entry_line',
        targetId: line.id,
      },
      order: { decidedAt: 'DESC' },
    });
    const rulings = await this.findRulingsForLine(line);
    return {
      line,
      suggestions,
      decisions,
      classificationEvidence: line.classificationEvidence,
      rulings,
    };
  }

  /**
   * R2-A-03 — pull up to 5 CROSS rulings that mention any of the candidate
   * HTS numbers for this line. Falls back to chapter / heading prefix match
   * when the full code doesn't hit. Skips silently if the rulings repo
   * isn't bound on this deploy.
   */
  private async findRulingsForLine(line: BrokerEntryLineEntity) {
    if (!this.rulings) return [];
    const targets = new Set<string>();
    if (line.htsNumber) targets.add(line.htsNumber);
    for (const alt of line.classificationEvidence?.alternatives ?? []) {
      if (alt.hts) targets.add(alt.hts);
    }
    if (targets.size === 0) return [];
    try {
      const exact = await this.rulings
        .createQueryBuilder('r')
        .where("r.status = 'active'")
        .andWhere('r.htsNumbers && :nums::text[]', {
          nums: Array.from(targets),
        })
        .orderBy('r.rulingDate', 'DESC')
        .take(5)
        .getMany();
      if (exact.length > 0) {
        return exact.map((r) => this.toRulingSummary(r));
      }
      // Fall back to a heading prefix match (first 4 digits) — cast the
      // jsonb-style text array via unnest so we can ILIKE each element.
      const prefix = (line.htsNumber ?? '').replace(/\D/g, '').slice(0, 4);
      if (!prefix) return [];
      const headingMatches = await this.rulings
        .createQueryBuilder('r')
        .where("r.status = 'active'")
        .andWhere(
          `EXISTS (SELECT 1 FROM unnest(r.hts_numbers) AS h WHERE h ILIKE :pfx)`,
          { pfx: `${prefix}%` },
        )
        .orderBy('r.rulingDate', 'DESC')
        .take(5)
        .getMany();
      return headingMatches.map((r) => this.toRulingSummary(r));
    } catch (err) {
      this.logger.warn(
        `Ruling lookup failed: ${(err as Error).message} — returning []`,
      );
      return [];
    }
  }

  private toRulingSummary(r: CbpCrossRulingEntity) {
    return {
      rulingNumber: r.rulingNumber,
      collection: r.collection,
      subject: r.subject,
      rulingDate: r.rulingDate,
      htsNumbers: r.htsNumbers,
      sourceUrl: r.sourceUrl,
      excerpt: r.rulingText?.slice(0, 280) ?? null,
    };
  }

  /**
   * R2-A-04 — return the AI control policy for the calling org. Policy is
   * stored on OrganizationEntity.settings.brokerAiPolicy and merged with
   * sensible defaults so unconfigured orgs still get safe behaviour.
   */
  async getAiControlPolicy(ctx: RequestContext): Promise<BrokerAiPolicy> {
    this.assertAuthenticated(ctx);
    if (!this.organizations) return DEFAULT_BROKER_AI_POLICY;
    const org = await this.organizations.findOne({
      where: { id: ctx.organizationId },
    });
    const stored = (org?.settings as Record<string, unknown> | null)?.[
      'brokerAiPolicy'
    ] as Partial<BrokerAiPolicy> | undefined;
    return mergePolicy(stored);
  }

  async setAiControlPolicy(
    ctx: RequestContext,
    patch: Partial<BrokerAiPolicy>,
  ): Promise<BrokerAiPolicy> {
    this.assertAuthenticated(ctx);
    if (!this.organizations) {
      throw new BadRequestException(
        'Organization repository not wired on this deploy',
      );
    }
    const org = await this.organizations.findOne({
      where: { id: ctx.organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const next = mergePolicy(
      {
        ...((org.settings as Record<string, unknown> | null)?.[
          'brokerAiPolicy'
        ] ?? {}),
        ...patch,
      } as Partial<BrokerAiPolicy>,
    );
    org.settings = {
      ...(org.settings ?? {}),
      brokerAiPolicy: next,
    };
    await this.organizations.save(org);
    await this.audit.record({
      eventType: 'broker_decisions.ai_policy.updated',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'organization',
      resourceId: ctx.organizationId,
      source: 'broker-decisions',
      metadata: { policy: next },
    });
    return next;
  }

  /**
   * R1-C-02 — UI pre-flight: returns the set of suggestion types pending on
   * a target and whether each one requires the licensed-broker checkbox.
   * Lets the workbench disable Accept before a 403 round-trip.
   */
  async checkAcceptability(
    ctx: RequestContext,
    targetType: BrokerAiSuggestionEntity['targetType'],
    targetId: string,
  ) {
    this.assertAuthenticated(ctx);
    const rows = await this.suggestions.find({
      where: {
        brokerOrganizationId: ctx.organizationId,
        targetType,
        targetId,
        status: 'pending',
      },
    });
    return rows.map((s) => ({
      suggestionId: s.id,
      suggestionType: s.suggestionType,
      requiresLicensedBroker: LICENSED_BROKER_REQUIRED.has(s.suggestionType),
    }));
  }

  /**
   * R1-C-04 — "reuse prior decision" picker. Returns historical decisions
   * on broker_entry_line targets whose description matches the supplied
   * query, scoped to the caller's tenant and limited to accepted/overridden
   * outcomes. Powers the workbench's "copy from prior" button.
   */
  async searchPriorDecisions(
    ctx: RequestContext,
    query: string,
    limit = 10,
  ) {
    this.assertAuthenticated(ctx);
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      throw new BadRequestException(
        'searchPriorDecisions requires at least 3 characters',
      );
    }
    const cappedLimit = Math.min(Math.max(limit, 1), 25);
    // Join decisions → lines so we can match on the line's description.
    const rows = await this.decisions
      .createQueryBuilder('d')
      .innerJoin(BrokerEntryLineEntity, 'line', 'line.id = d.targetId')
      .where('d.brokerOrganizationId = :orgId', {
        orgId: ctx.organizationId,
      })
      .andWhere('d.targetType = :tt', { tt: 'broker_entry_line' })
      .andWhere('d.decision IN (:...accepted)', {
        accepted: ['accept', 'override'],
      })
      .andWhere('line.description ILIKE :q', { q: `%${trimmed}%` })
      .orderBy('d.decidedAt', 'DESC')
      .take(cappedLimit)
      .getMany();
    if (!rows.length) return [];
    const lineIds = rows.map((d) => d.targetId);
    const lines = await this.lines.find({
      where: lineIds.map((id) => ({ id })),
    });
    const lineById = new Map(lines.map((l) => [l.id, l]));
    return rows.map((d) => {
      const line = lineById.get(d.targetId);
      return {
        decisionId: d.id,
        decidedAt: d.decidedAt,
        suggestionType: d.suggestionType,
        decision: d.decision,
        finalValue: d.finalValue,
        line: line
          ? {
              id: line.id,
              description: line.description,
              htsNumber: line.htsNumber,
              countryOfOrigin: line.countryOfOrigin,
            }
          : null,
      };
    });
  }

  async listDecisionsForEntry(ctx: RequestContext, entryId: string) {
    this.assertAuthenticated(ctx);
    const entry = await this.entries.findOne({ where: { id: entryId } });
    if (!entry || entry.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Entry belongs to another tenant');
    }
    const lines = await this.lines.find({ where: { entryId } });
    const lineIds = lines.map((l) => l.id);
    const decisionRows = lineIds.length
      ? await this.decisions
          .createQueryBuilder('decision')
          .where('decision.brokerOrganizationId = :orgId', {
            orgId: ctx.organizationId,
          })
          .andWhere(
            '(decision.targetId IN (:...lineIds) OR decision.targetId = :entryId)',
            { lineIds, entryId },
          )
          .orderBy('decision.decidedAt', 'DESC')
          .getMany()
      : await this.decisions.find({
          where: {
            brokerOrganizationId: ctx.organizationId,
            targetType: 'broker_entry',
            targetId: entryId,
          },
        });
    return decisionRows;
  }

  private async applyDecisionToLine(
    suggestion: BrokerAiSuggestionEntity,
    decision: BrokerDecisionEntity,
  ) {
    const line = await this.lines.findOne({
      where: { id: suggestion.targetId },
    });
    if (!line) return;

    // Cross-check tenancy via the parent entry. The suggestion was already
    // tenant-checked, but a corrupt suggestion -> line pointer would otherwise
    // be silently honored.
    const parent = await this.entries.findOne({ where: { id: line.entryId } });
    if (
      !parent ||
      parent.brokerOrganizationId !== suggestion.brokerOrganizationId
    ) {
      this.logger.warn(
        `Skipping applyDecisionToLine: line ${line.id} parent entry tenant mismatch`,
      );
      return;
    }

    const value = (decision.finalValue ?? suggestion.value) as Record<
      string,
      unknown
    >;

    switch (suggestion.suggestionType) {
      case 'hts_classification': {
        const hts =
          typeof value.htsNumber === 'string' ? value.htsNumber : null;
        if (hts) line.htsNumber = hts;
        line.classificationStatus =
          decision.decision === 'override'
            ? 'human_overridden'
            : 'human_accepted';
        line.classificationEvidence = {
          ...(line.classificationEvidence ?? {}),
          suggestedHts: hts ?? line.classificationEvidence?.suggestedHts,
          notes:
            typeof value.notes === 'string'
              ? value.notes
              : line.classificationEvidence?.notes,
        };
        break;
      }
      case 'origin': {
        const coo =
          typeof value.countryOfOrigin === 'string'
            ? value.countryOfOrigin
            : null;
        if (coo) line.countryOfOrigin = coo;
        break;
      }
      case 'value': {
        const total = value.totalValue;
        if (total != null) line.totalValue = String(total);
        const unit = value.unitValue;
        if (unit != null) line.unitValue = String(unit);
        break;
      }
      case 'pga_disclaimer':
      case 'special_program': {
        // Append a policy flag instead of overwriting.
        const program =
          typeof value.program === 'string'
            ? value.program
            : suggestion.suggestionType.toUpperCase();
        const flagCode =
          typeof value.code === 'string' ? value.code : null;
        const note =
          typeof value.note === 'string' ? value.note : null;
        const existing = line.policyFlags ?? [];
        const alreadyPresent = existing.some(
          (f) => f.program === program && f.code === flagCode,
        );
        if (!alreadyPresent) {
          line.policyFlags = [
            ...existing,
            { program, code: flagCode ?? undefined, note: note ?? undefined },
          ];
        }
        break;
      }
      case 'document_field_fix': {
        // Document-field fixes don't directly mutate the entry line; they're
        // reflected on the extracted-field row by the packets service. We
        // still record metadata for traceability.
        line.metadata = {
          ...(line.metadata ?? {}),
          lastDocumentFieldFixDecisionId: decision.id,
        };
        break;
      }
      default:
        // missing_info_question / reject_remediation don't apply to a line.
        return;
    }

    await this.lines.save(line);
  }

  private async requireOwnedSuggestion(ctx: RequestContext, id: string) {
    this.assertAuthenticated(ctx);
    const suggestion = await this.suggestions.findOne({ where: { id } });
    if (!suggestion) throw new NotFoundException('Suggestion not found');
    if (suggestion.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Suggestion belongs to another tenant');
    }
    return suggestion;
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }
}
