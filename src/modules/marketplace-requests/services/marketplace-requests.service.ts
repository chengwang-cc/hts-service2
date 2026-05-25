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
import { AuditService } from '../../audit/services/audit.service';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import { BrokerClientEntity } from '../../broker-core/entities/broker-client.entity';
import { BrokerRelationshipsService } from '../../broker-core/services/broker-relationships.service';
import { BrokerEntriesService } from '../../broker-entries/services/broker-entries.service';
import { DocumentStorageService } from '../../documents/document-storage.service';
import { StripeService } from '../../billing/services/stripe.service';
import { BrokerCreditsService } from '../../marketplace-reviews/services/broker-credits.service';
import { MarketplaceBrokerProfileEntity } from '../../marketplace/entities';
import {
  AcceptQuoteDto,
  ConsentToFullPacketDto,
  CreateMarketplaceRequestDto,
  CreateQuoteDto,
  DeclineLeadDto,
  ListMarketplaceRequestsDto,
  SendMessageDto,
} from '../dto/marketplace-requests.dto';
import {
  MarketplaceBrokerMatchEntity,
  MarketplaceConversationEntity,
  MarketplaceMessageEntity,
  MarketplaceQuoteEntity,
  MarketplaceRequestEntity,
} from '../entities';
import { BrokerMatchingService } from './broker-matching.service';
import { RequestPreflightService } from './request-preflight.service';

@Injectable()
export class MarketplaceRequestsService {
  constructor(
    @InjectRepository(MarketplaceRequestEntity)
    private readonly requests: Repository<MarketplaceRequestEntity>,
    @InjectRepository(MarketplaceQuoteEntity)
    private readonly quotes: Repository<MarketplaceQuoteEntity>,
    @InjectRepository(MarketplaceBrokerMatchEntity)
    private readonly matches: Repository<MarketplaceBrokerMatchEntity>,
    @InjectRepository(MarketplaceConversationEntity)
    private readonly conversations: Repository<MarketplaceConversationEntity>,
    @InjectRepository(MarketplaceMessageEntity)
    private readonly messages: Repository<MarketplaceMessageEntity>,
    @InjectRepository(BrokerClientEntity)
    private readonly brokerClients: Repository<BrokerClientEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizations: Repository<OrganizationEntity>,
    private readonly preflight: RequestPreflightService,
    private readonly matching: BrokerMatchingService,
    private readonly relationships: BrokerRelationshipsService,
    private readonly entries: BrokerEntriesService,
    private readonly audit: AuditService,
    private readonly storage: DocumentStorageService,
    @Optional() private readonly stripe: StripeService | null = null,
    @Optional() private readonly credits: BrokerCreditsService | null = null,
    @Optional()
    @InjectRepository(MarketplaceBrokerProfileEntity)
    private readonly profiles: Repository<MarketplaceBrokerProfileEntity> | null = null,
  ) {}

  private readonly logger = new Logger(MarketplaceRequestsService.name);

  async create(ctx: RequestContext, dto: CreateMarketplaceRequestDto) {
    this.assertAuthenticated(ctx);
    const preflight = await this.preflight.preflight(dto);

    const entity = this.requests.create({
      requestingOrganizationId: ctx.organizationId,
      requestingUserId: ctx.userId,
      status: 'open',
      requestType: dto.requestType ?? 'one_time',
      title: dto.title ?? null,
      commoditySummary: dto.commoditySummary,
      originCountry: dto.originCountry ?? null,
      destinationCountry: dto.destinationCountry ?? null,
      portOfEntry: dto.portOfEntry ?? null,
      mode: dto.mode ?? null,
      candidateHtsNumbers: preflight.candidateHtsNumbers,
      regulatoryFlags: preflight.regulatoryFlags,
      serviceCategories: dto.serviceCategories ?? [],
      shipmentValue: dto.shipmentValue != null ? String(dto.shipmentValue) : null,
      shipmentCurrency: dto.shipmentCurrency ?? null,
      shipmentVolume: dto.shipmentVolume ?? null,
      readinessScore: preflight.readinessScore,
      readinessBreakdown: preflight.readinessBreakdown,
      visibilityMode: dto.visibilityMode ?? 'invited',
      deadline: dto.deadline ?? null,
      metadata: dto.metadata ?? null,
    });

    const saved = await this.requests.save(entity);

    await this.matching.matchRequest(saved);

    await this.audit.record({
      eventType: 'marketplace_request.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_request',
      resourceId: saved.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { readinessScore: saved.readinessScore },
    });

    return this.getDetail(ctx, saved.id);
  }

  async list(ctx: RequestContext, dto: ListMarketplaceRequestsDto) {
    this.assertAuthenticated(ctx);
    const limit = dto.limit ?? 25;
    const offset = dto.offset ?? 0;

    const qb = this.requests
      .createQueryBuilder('request')
      .where('request.requestingOrganizationId = :orgId', {
        orgId: ctx.organizationId,
      });

    if (dto.status) {
      const statuses = dto.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length) {
        qb.andWhere('request.status IN (:...statuses)', { statuses });
      }
    }

    qb.orderBy('request.updatedAt', 'DESC').take(limit).skip(offset);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total, limit, offset };
  }

  async getDetail(ctx: RequestContext, id: string) {
    const request = await this.requests.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.requestingOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Request belongs to another tenant');
    }
    const matches = await this.matching.listForRequest(request.id);
    const quotes = await this.quotes.find({
      where: { requestId: request.id },
      order: { createdAt: 'DESC' },
    });
    const conversations = await this.conversations.find({
      where: { requestId: request.id },
      order: { updatedAt: 'DESC' },
    });
    return { ...request, matches, quotes, conversations };
  }

  async recomputeMatches(ctx: RequestContext, id: string) {
    const request = await this.getOwnedRequest(ctx, id);
    await this.matching.matchRequest(request);
    return this.getDetail(ctx, id);
  }

  async close(ctx: RequestContext, id: string) {
    const request = await this.getOwnedRequest(ctx, id);
    request.status = 'closed';
    await this.requests.save(request);

    // R1-B-03 — closing a request expires every still-submitted quote and
    // cancels any open match thread that didn't get to quote.
    const openQuotes = await this.quotes.find({
      where: { requestId: id, status: 'submitted' },
    });
    for (const quote of openQuotes) {
      quote.status = 'expired';
      await this.quotes.save(quote);
    }
    const openMatches = await this.matches
      .createQueryBuilder('m')
      .where('m.requestId = :id', { id })
      .andWhere('m.status NOT IN (:...closed)', {
        closed: ['selected', 'declined', 'expired'],
      })
      .getMany();
    for (const match of openMatches) {
      match.status = 'expired';
      await this.matches.save(match);
    }

    await this.audit.record({
      eventType: 'marketplace_request.closed',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_request',
      resourceId: request.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        expiredQuotes: openQuotes.length,
        cancelledMatches: openMatches.length,
      },
    });
    return this.getDetail(ctx, id);
  }

  /**
   * R1-B-01 — broker rescinds an accepted (or submitted) quote. The
   * relationship and draft entry created in acceptQuote() are paused/marked
   * rescinded so the broker work queue clears. Inside the rescission window
   * (default 48h) we auto-undo; outside the window we record the request
   * but leave the engagement intact — the broker must coordinate manually.
   */
  async rescindQuote(
    ctx: RequestContext,
    quoteId: string,
    reason: string | null,
  ) {
    this.assertAuthenticated(ctx);
    const quote = await this.quotes.findOne({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.brokerOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Quote belongs to another tenant');
    }
    if (quote.status !== 'accepted' && quote.status !== 'submitted') {
      throw new BadRequestException(
        `Cannot rescind a quote in ${quote.status} state`,
      );
    }

    const windowHours = Number(
      process.env.MARKETPLACE_QUOTE_RESCIND_WINDOW_HOURS || 48,
    );
    const acceptedAtMs = quote.acceptedAt?.getTime() ?? null;
    const insideWindow =
      acceptedAtMs !== null &&
      Date.now() - acceptedAtMs <= windowHours * 60 * 60 * 1000;

    const wasAccepted = quote.status === 'accepted';
    quote.status = 'withdrawn';
    quote.metadata = {
      ...(quote.metadata ?? {}),
      rescindedAt: new Date().toISOString(),
      rescindReason: reason,
      rescindInsideWindow: insideWindow,
    };
    await this.quotes.save(quote);

    let relationshipPaused = false;
    let draftEntryCancelled = false;
    if (wasAccepted && insideWindow) {
      const relationship = await this.relationships.findByMarketplaceQuoteId(
        quote.id,
      );
      if (relationship) {
        await this.relationships.updateStatus(
          relationship.id,
          'paused',
          ctx,
          { reason: 'quote_rescinded', quoteId: quote.id },
        );
        relationshipPaused = true;
        draftEntryCancelled = await this.entries.cancelHandoffDraft({
          brokerOrganizationId: relationship.brokerOrganizationId,
          marketplaceQuoteId: quote.id,
          reason: 'quote_rescinded',
        });
      }
      // Reopen the request and clear the broker selection so the business
      // can pick a different quote (which may have already expired — we'll
      // leave that to the UI/business to refresh).
      const request = await this.requests.findOne({
        where: { id: quote.requestId },
      });
      if (request) {
        request.status = 'in_quotes';
        request.selectedBrokerProfileId = null;
        request.selectedQuoteId = null;
        await this.requests.save(request);
      }
    }

    await this.audit.record({
      eventType: 'marketplace_quote.rescinded',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_quote',
      resourceId: quote.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        reason,
        wasAccepted,
        insideWindow,
        relationshipPaused,
        draftEntryCancelled,
      },
    });

    return {
      quote,
      wasAccepted,
      insideWindow,
      relationshipPaused,
      draftEntryCancelled,
    };
  }

  /**
   * R1-B-02 — expire all submitted quotes whose expiresAt has passed. Used
   * by the cron worker (MarketplaceQuoteExpiryWorker).
   */
  async expireDueQuotes(): Promise<number> {
    const now = new Date();
    const due = await this.quotes
      .createQueryBuilder('q')
      .where('q.status = :status', { status: 'submitted' })
      .andWhere('q.expiresAt IS NOT NULL')
      .andWhere('q.expiresAt <= :now', { now })
      .getMany();
    if (!due.length) return 0;
    for (const quote of due) {
      quote.status = 'expired';
      await this.quotes.save(quote);
      await this.audit.record({
        eventType: 'marketplace_quote.auto_expired',
        organizationId: quote.brokerOrganizationId,
        resourceType: 'marketplace_quote',
        resourceId: quote.id,
        source: 'marketplace-cron',
        metadata: { expiresAt: quote.expiresAt },
      });
    }
    return due.length;
  }

  async listBrokerLeads(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    const matches = await this.matching.listForBroker(ctx.organizationId);
    if (!matches.length) return [];
    const requestIds = Array.from(new Set(matches.map((m) => m.requestId)));
    const requests = await this.requests.find({
      where: requestIds.map((id) => ({ id })),
    });
    const requestById = new Map(requests.map((r) => [r.id, r]));
    return matches.map((match) => ({
      match,
      request: requestById.get(match.requestId)
        ? this.brokerVisibleRequest(requestById.get(match.requestId)!)
        : null,
    }));
  }

  async getBrokerLead(ctx: RequestContext, matchId: string) {
    this.assertAuthenticated(ctx);
    const match = await this.matches.findOne({ where: { id: matchId } });
    if (!match || match.brokerOrganizationId !== ctx.organizationId) {
      throw new NotFoundException('Lead not found');
    }
    await this.matching.markViewed(matchId, ctx.organizationId);
    const request = await this.requests.findOne({
      where: { id: match.requestId },
    });
    if (!request) throw new NotFoundException('Request not found');
    const quotes = await this.quotes.find({
      where: { requestId: request.id, brokerOrganizationId: ctx.organizationId },
    });
    const conversation = await this.conversations.findOne({
      where: {
        requestId: request.id,
        brokerOrganizationId: ctx.organizationId,
      },
    });
    return {
      match,
      request: this.brokerVisibleRequest(request, conversation),
      quotes,
      conversationId: conversation?.id ?? null,
    };
  }

  async declineLead(ctx: RequestContext, matchId: string, dto: DeclineLeadDto) {
    const match = await this.matching.decline(
      matchId,
      ctx.organizationId,
      dto.reason,
    );
    if (!match) throw new NotFoundException('Lead not found');
    await this.audit.record({
      eventType: 'marketplace_request.lead_declined',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_broker_match',
      resourceId: match.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return match;
  }

  async submitQuote(ctx: RequestContext, matchId: string, dto: CreateQuoteDto) {
    this.assertAuthenticated(ctx);
    const match = await this.matches.findOne({ where: { id: matchId } });
    if (!match || match.brokerOrganizationId !== ctx.organizationId) {
      throw new NotFoundException('Lead not found');
    }

    // R2-D-02 — consume one lead credit per quote submission. Pro brokers
    // get a discounted cost (0 by default), free brokers pay full price.
    // Disabled when credits service is unbound (e.g. in unit tests) or
    // when MARKETPLACE_LEAD_CREDIT_COST=0.
    await this.consumeLeadCreditForQuote(ctx, match);

    const conversation = await this.ensureConversation(
      match.requestId,
      match.brokerProfileId,
      match.brokerOrganizationId,
    );

    const quote = this.quotes.create({
      requestId: match.requestId,
      brokerProfileId: match.brokerProfileId,
      brokerOrganizationId: ctx.organizationId,
      matchId: match.id,
      status: 'submitted',
      serviceScope: dto.serviceScope ?? null,
      feeModel: dto.feeModel ?? 'flat',
      feeBreakdown: dto.feeBreakdown ?? null,
      estimatedTotal:
        dto.estimatedTotal != null ? String(dto.estimatedTotal) : null,
      currency: dto.currency ?? 'USD',
      estimatedTimeline: dto.estimatedTimeline ?? null,
      requiredDocuments: dto.requiredDocuments ?? [],
      brokerNotes: dto.brokerNotes ?? null,
      brokerQuestions: dto.brokerQuestions ?? null,
      submittedAt: new Date(),
      expiresAt: dto.expiresAt ?? null,
    });
    const saved = await this.quotes.save(quote);

    match.status = 'quoted';
    await this.matches.save(match);

    const request = await this.requests.findOne({ where: { id: match.requestId } });
    if (request && request.status === 'open') {
      request.status = 'in_quotes';
      await this.requests.save(request);
    }

    await this.audit.record({
      eventType: 'marketplace_quote.submitted',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_quote',
      resourceId: saved.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { requestId: match.requestId, conversationId: conversation.id },
    });

    return saved;
  }

  async acceptQuote(ctx: RequestContext, quoteId: string, dto: AcceptQuoteDto) {
    this.assertAuthenticated(ctx);
    const quote = await this.quotes.findOne({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException('Quote not found');

    const request = await this.requests.findOne({
      where: { id: quote.requestId },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.requestingOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Quote belongs to another tenant');
    }
    if (quote.status !== 'submitted') {
      throw new BadRequestException(`Cannot accept a ${quote.status} quote`);
    }

    quote.status = 'accepted';
    quote.acceptedAt = new Date();
    quote.acceptedByUserId = ctx.userId;
    await this.quotes.save(quote);

    request.status = 'broker_selected';
    request.selectedBrokerProfileId = quote.brokerProfileId;
    request.selectedQuoteId = quote.id;
    await this.requests.save(request);

    // Mark match as selected, expire other quotes for the same request
    await this.matches.update(
      { requestId: quote.requestId, brokerProfileId: quote.brokerProfileId },
      { status: 'selected' },
    );
    const otherQuotes = await this.quotes.find({
      where: { requestId: quote.requestId, status: 'submitted' },
    });
    for (const other of otherQuotes) {
      if (other.id !== quote.id) {
        other.status = 'expired';
        await this.quotes.save(other);
      }
    }

    // Phase 4 handoff (plan M4-08): create broker-side client + relationship
    // + a placeholder draft entry so the engagement appears in the broker
    // work queue immediately.
    const brokerClient = await this.findOrCreateBrokerClient(
      quote.brokerOrganizationId,
      ctx.organizationId,
    );

    const relationship = await this.relationships.create({
      brokerOrganizationId: quote.brokerOrganizationId,
      businessOrganizationId: ctx.organizationId,
      clientId: brokerClient.id,
      brokerProfileId: quote.brokerProfileId,
      marketplaceRequestId: request.id,
      marketplaceQuoteId: quote.id,
    });

    const draftEntry = await this.entries.draftFromHandoff({
      brokerOrganizationId: quote.brokerOrganizationId,
      clientId: brokerClient.id,
      entryType: 'consumption',
      metadata: {
        marketplaceRequestId: request.id,
        marketplaceQuoteId: quote.id,
        relationshipId: relationship.id,
        commoditySummary: request.commoditySummary,
      },
    });

    await this.audit.record({
      eventType: 'marketplace_quote.accepted',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_quote',
      resourceId: quote.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        note: dto.note ?? null,
        relationshipId: relationship.id,
        brokerClientId: brokerClient.id,
        draftEntryId: draftEntry.id,
      },
    });

    return { quote, relationship, brokerClientId: brokerClient.id, draftEntryId: draftEntry.id };
  }

  /**
   * Looks up the broker's existing client record for this business org and
   * returns it; creates one if none exists. The broker can rename / update
   * fields later from their own client management UI.
   *
   * Race-safe: the (broker_organization_id, client_organization_id) tuple is
   * protected by a partial unique index. If two concurrent accept-quote
   * handoffs collide we catch the unique violation and re-read the winning
   * row instead of returning a duplicate.
   */
  private async findOrCreateBrokerClient(
    brokerOrganizationId: string,
    businessOrganizationId: string,
  ): Promise<BrokerClientEntity> {
    const existing = await this.brokerClients.findOne({
      where: {
        brokerOrganizationId,
        clientOrganizationId: businessOrganizationId,
      },
    });
    if (existing) return existing;

    const businessOrg = await this.organizations.findOne({
      where: { id: businessOrganizationId },
    });
    const fallbackName =
      businessOrg?.name ??
      `Client ${businessOrganizationId.slice(0, 8)}`;

    const entity = this.brokerClients.create({
      brokerOrganizationId,
      clientOrganizationId: businessOrganizationId,
      name: fallbackName,
      status: 'onboarding',
    });
    try {
      return await this.brokerClients.save(entity);
    } catch (err) {
      // Unique violation (Postgres 23505) — another handoff won the race.
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        const winner = await this.brokerClients.findOne({
          where: {
            brokerOrganizationId,
            clientOrganizationId: businessOrganizationId,
          },
        });
        if (winner) return winner;
      }
      throw err;
    }
  }

  async listMatchesForRequest(ctx: RequestContext, requestId: string) {
    await this.getOwnedRequest(ctx, requestId);
    return this.matching.listForRequest(requestId);
  }

  async listQuotesForRequest(ctx: RequestContext, requestId: string) {
    await this.getOwnedRequest(ctx, requestId);
    return this.quotes.find({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Pushes a request to specific verified brokers. Re-uses the match score
   * but bumps status to 'notified' so the broker sees the lead.
   */
  async inviteBrokers(
    ctx: RequestContext,
    requestId: string,
    brokerProfileIds: string[],
  ) {
    const request = await this.getOwnedRequest(ctx, requestId);
    if (!brokerProfileIds.length) {
      throw new BadRequestException('brokerProfileIds is required');
    }
    const created = await this.matching.inviteSpecificBrokers(
      request,
      brokerProfileIds,
    );
    await this.audit.record({
      eventType: 'marketplace_request.brokers_invited',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_request',
      resourceId: request.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { brokerProfileIds, createdCount: created.length },
    });
    return created;
  }

  /**
   * Plan-aligned message endpoint scoped by request. Requires the caller to
   * specify which broker conversation thread to send into (business sees
   * multiple), and derives the conversation row.
   */
  async sendMessageOnRequest(
    ctx: RequestContext,
    requestId: string,
    brokerProfileId: string,
    body: string,
  ) {
    if (!body || body.trim().length === 0) {
      throw new BadRequestException('Message body is required');
    }
    const request = await this.requests.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    if (
      request.requestingOrganizationId !== ctx.organizationId &&
      // Allow the broker matched on this request to send too.
      !(await this.isBrokerForRequest(requestId, ctx.organizationId))
    ) {
      throw new ForbiddenException('Not a participant on this request');
    }
    if (!brokerProfileId) {
      throw new BadRequestException('brokerProfileId is required');
    }
    // Find the broker organizationId via match record
    const match = await this.matches.findOne({
      where: { requestId, brokerProfileId },
    });
    if (!match) {
      throw new NotFoundException(
        'No matched broker thread for the given brokerProfileId',
      );
    }
    const conversation = await this.ensureConversation(
      requestId,
      brokerProfileId,
      match.brokerOrganizationId,
    );
    return this.sendMessage(ctx, conversation.id, { body });
  }

  async listMessagesForRequest(
    ctx: RequestContext,
    requestId: string,
    brokerProfileId?: string,
  ) {
    const request = await this.requests.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    const isBusiness =
      request.requestingOrganizationId === ctx.organizationId;
    const isBroker = await this.isBrokerForRequest(requestId, ctx.organizationId);
    if (!isBusiness && !isBroker) {
      throw new ForbiddenException('Not a participant on this request');
    }

    const conversationsForRequest = await this.conversations.find({
      where: brokerProfileId
        ? { requestId, brokerProfileId }
        : isBusiness
          ? { requestId }
          : { requestId, brokerOrganizationId: ctx.organizationId },
    });
    if (!conversationsForRequest.length) return [];

    const ids = conversationsForRequest.map((c) => c.id);
    const messages = await this.messages
      .createQueryBuilder('m')
      .where('m.conversationId IN (:...ids)', { ids })
      .orderBy('m.createdAt', 'ASC')
      .take(500)
      .getMany();
    return messages.map((r) => this.redactIfHidden(r));
  }

  /**
   * Static facets used by the public marketplace search UI. Returns the
   * union of distinct facet values from published+verified profiles.
   */
  async searchFacets() {
    const profiles = await this.matching.allPublishedProfiles();
    const collect = (key: 'countries' | 'serviceCategories' | 'shipmentModes' | 'specialties' | 'ports') => {
      const set = new Set<string>();
      for (const p of profiles) {
        const arr = ((p as unknown) as Record<string, string[]>)[key];
        if (Array.isArray(arr)) for (const v of arr) if (v) set.add(v);
      }
      return Array.from(set).sort();
    };
    return {
      countries: collect('countries'),
      serviceCategories: collect('serviceCategories'),
      shipmentModes: collect('shipmentModes'),
      specialties: collect('specialties'),
      ports: collect('ports'),
    };
  }

  private async isBrokerForRequest(
    requestId: string,
    organizationId: string,
  ): Promise<boolean> {
    const match = await this.matches.findOne({
      where: { requestId, brokerOrganizationId: organizationId },
    });
    return Boolean(match);
  }

  async ensureConversation(
    requestId: string,
    brokerProfileId: string,
    brokerOrganizationId: string,
  ): Promise<MarketplaceConversationEntity> {
    const existing = await this.conversations.findOne({
      where: { requestId, brokerOrganizationId },
    });
    if (existing) return existing;

    const request = await this.requests.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');

    const conversation = this.conversations.create({
      requestId,
      businessOrganizationId: request.requestingOrganizationId,
      brokerOrganizationId,
      brokerProfileId,
      status: 'active',
      fullPacketConsented: false,
    });
    return this.conversations.save(conversation);
  }

  async sendMessage(
    ctx: RequestContext,
    conversationId: string,
    dto: SendMessageDto,
  ) {
    this.assertAuthenticated(ctx);
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const role = this.resolveSenderRole(ctx, conversation);
    if (!role) {
      throw new ForbiddenException('Not a participant of this conversation');
    }

    // Refuse to attach files whose storage keys don't belong to the sender's
    // tenant — defends against attaching arbitrary keys from other orgs.
    const attachmentRecords = (dto.attachments ?? []).map((att) => {
      if (
        !this.storage.keyBelongsToTenant(att.storageKey, ctx.organizationId)
      ) {
        throw new ForbiddenException(
          `Attachment storage key ${att.storageKey} is not owned by sender`,
        );
      }
      return { ...att, sharedFull: conversation.fullPacketConsented };
    });

    const message = this.messages.create({
      conversationId,
      senderUserId: ctx.userId,
      senderOrganizationId: ctx.organizationId,
      senderRole: role,
      body: dto.body,
      attachments: attachmentRecords.length ? attachmentRecords : null,
    });
    const saved = await this.messages.save(message);

    conversation.lastMessageAt = saved.createdAt;
    await this.conversations.save(conversation);

    await this.audit.record({
      eventType: 'marketplace_conversation.message_sent',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_message',
      resourceId: saved.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { conversationId },
    });

    return saved;
  }

  async listMessages(ctx: RequestContext, conversationId: string) {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (!this.resolveSenderRole(ctx, conversation)) {
      throw new ForbiddenException('Not a participant of this conversation');
    }
    const rows = await this.messages.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: 500,
    });
    return rows.map((r) => this.redactIfHidden(r));
  }

  /**
   * R1-A-03 — advance the caller's lastReadAt cursor to `at` (or now). Both
   * sides have their own cursor on the conversation row; bumping one does
   * not move the other. Returns the updated conversation snapshot.
   */
  async markConversationRead(
    ctx: RequestContext,
    conversationId: string,
    at?: Date | null,
  ) {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const role = this.resolveSenderRole(ctx, conversation);
    if (!role) {
      throw new ForbiddenException('Not a participant of this conversation');
    }
    const cursor = at ?? new Date();
    if (role === 'broker') {
      conversation.brokerLastReadAt = cursor;
    } else {
      conversation.businessLastReadAt = cursor;
    }
    await this.conversations.save(conversation);
    return {
      conversationId: conversation.id,
      role,
      lastReadAt: cursor,
    };
  }

  /**
   * R1-D-04 — return the consent history timeline for a conversation,
   * scoped to participants. Used by the conversation thread UI to render
   * "Consent granted by Jane Doe on 2026-05-25" entries inline.
   */
  async getConsentHistory(ctx: RequestContext, conversationId: string) {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (!this.resolveSenderRole(ctx, conversation)) {
      throw new ForbiddenException('Not a participant of this conversation');
    }
    return {
      conversationId: conversation.id,
      current: conversation.fullPacketConsented,
      history: conversation.consentHistory ?? [],
    };
  }

  /**
   * R1-A-03 — unread counts for every conversation the caller participates
   * in, scoped to the caller's role. Counts exclude hidden messages and the
   * caller's own outbound messages. Used to badge the inbox.
   */
  async unreadCounts(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    const convos = await this.conversations.find({
      where: [
        { businessOrganizationId: ctx.organizationId },
        { brokerOrganizationId: ctx.organizationId },
      ],
    });
    if (!convos.length) return { rows: [], total: 0 };
    const rows: Array<{
      conversationId: string;
      requestId: string;
      role: 'business' | 'broker';
      unreadCount: number;
      lastMessageAt: Date | null;
    }> = [];
    let total = 0;
    for (const convo of convos) {
      const role = this.resolveSenderRole(ctx, convo);
      if (!role) continue;
      const cursor =
        role === 'broker'
          ? convo.brokerLastReadAt
          : convo.businessLastReadAt;
      const qb = this.messages
        .createQueryBuilder('m')
        .where('m.conversationId = :id', { id: convo.id })
        .andWhere('m.hidden = :hidden', { hidden: false })
        .andWhere('m.senderOrganizationId != :org', {
          org: ctx.organizationId,
        });
      if (cursor) {
        qb.andWhere('m.createdAt > :cursor', { cursor });
      }
      const unreadCount = await qb.getCount();
      total += unreadCount;
      rows.push({
        conversationId: convo.id,
        requestId: convo.requestId,
        role,
        unreadCount,
        lastMessageAt: convo.lastMessageAt,
      });
    }
    return { rows, total };
  }

  /**
   * R1-A-04 — admin moderation. Hidden messages are returned to participants
   * as a redacted placeholder; attachments are stripped. Admin permission is
   * enforced by the controller, not the service.
   */
  async setMessageHidden(
    actorUserId: string,
    messageId: string,
    hidden: boolean,
    reason: string | null,
  ) {
    const message = await this.messages.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    message.hidden = hidden;
    message.hiddenByUserId = hidden ? actorUserId : null;
    message.hiddenAt = hidden ? new Date() : null;
    message.hiddenReason = hidden ? reason : null;
    const saved = await this.messages.save(message);
    await this.audit.record({
      eventType: hidden
        ? 'marketplace_message.hidden'
        : 'marketplace_message.unhidden',
      actorUserId,
      resourceType: 'marketplace_message',
      resourceId: saved.id,
      source: 'marketplace-admin',
      metadata: { reason },
    });
    return saved;
  }

  /**
   * R1-B-04 — create a Stripe checkout session for concierge priority intake
   * and a draft marketplace request that the checkout webhook will later
   * promote to `priority='concierge'`. Returns the hosted checkout URL.
   *
   * Required env: STRIPE_CONCIERGE_PRICE_ID (one-time price in Stripe),
   * MARKETPLACE_CONCIERGE_SUCCESS_URL, MARKETPLACE_CONCIERGE_CANCEL_URL.
   */
  async startConciergeIntake(
    ctx: RequestContext,
    dto: CreateMarketplaceRequestDto,
  ) {
    this.assertAuthenticated(ctx);
    if (!this.stripe) {
      throw new BadRequestException(
        'Stripe integration is not configured on this deployment',
      );
    }
    const priceId = process.env.STRIPE_CONCIERGE_PRICE_ID;
    if (!priceId) {
      throw new BadRequestException(
        'STRIPE_CONCIERGE_PRICE_ID is not configured',
      );
    }
    const successBase =
      process.env.MARKETPLACE_CONCIERGE_SUCCESS_URL ||
      `${process.env.API_BASE_URL ?? 'http://localhost:3100'}/marketplace/concierge/success`;
    const cancelUrl =
      process.env.MARKETPLACE_CONCIERGE_CANCEL_URL ||
      `${process.env.API_BASE_URL ?? 'http://localhost:3100'}/marketplace/concierge/cancel`;

    // Create the request up-front as a draft; the webhook will promote it.
    const preflight = await this.preflight.preflight(dto);
    const draft = await this.requests.save(
      this.requests.create({
        requestingOrganizationId: ctx.organizationId,
        requestingUserId: ctx.userId,
        status: 'draft',
        requestType: dto.requestType ?? 'one_time',
        title: dto.title ?? null,
        commoditySummary: dto.commoditySummary,
        originCountry: dto.originCountry ?? null,
        destinationCountry: dto.destinationCountry ?? null,
        portOfEntry: dto.portOfEntry ?? null,
        mode: dto.mode ?? null,
        candidateHtsNumbers: preflight.candidateHtsNumbers,
        regulatoryFlags: preflight.regulatoryFlags,
        serviceCategories: dto.serviceCategories ?? [],
        readinessScore: preflight.readinessScore,
        readinessBreakdown: preflight.readinessBreakdown,
        visibilityMode: 'invited',
        priority: 'standard',
        metadata: { conciergeIntake: true, ...(dto.metadata ?? {}) },
      }),
    );

    const session = await this.stripe.createFlexibleCheckoutSession({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${successBase}?session_id={CHECKOUT_SESSION_ID}&request_id=${draft.id}`,
      cancel_url: `${cancelUrl}?request_id=${draft.id}`,
      client_reference_id: draft.id,
      metadata: {
        marketplaceRequestId: draft.id,
        organizationId: ctx.organizationId,
        flow: 'concierge_intake',
      },
    });

    await this.audit.record({
      eventType: 'marketplace_request.concierge_intake_started',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_request',
      resourceId: draft.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { stripeSessionId: session.id },
    });

    return {
      requestId: draft.id,
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  }

  /**
   * R1-B-04 — called by the Stripe webhook on checkout.session.completed.
   * Flips the referenced draft request to `priority='concierge'`, opens
   * matching, and records the payment intent for receipts/refunds.
   */
  async promoteConciergeRequest(
    requestId: string,
    paymentIntentId: string,
  ): Promise<MarketplaceRequestEntity> {
    const request = await this.requests.findOne({ where: { id: requestId } });
    if (!request) {
      this.logger.warn(
        `Concierge promotion skipped — request ${requestId} not found`,
      );
      throw new NotFoundException('Request not found');
    }
    if (request.priority === 'concierge') {
      // Already promoted (webhook redelivery) — idempotent no-op.
      return request;
    }
    request.priority = 'concierge';
    request.conciergePaymentIntentId = paymentIntentId;
    request.conciergePaidAt = new Date();
    if (request.status === 'draft') {
      request.status = 'open';
    }
    const saved = await this.requests.save(request);
    await this.matching.matchRequest(saved);
    await this.audit.record({
      eventType: 'marketplace_request.concierge_promoted',
      organizationId: saved.requestingOrganizationId,
      resourceType: 'marketplace_request',
      resourceId: saved.id,
      source: 'marketplace-stripe-webhook',
      metadata: { paymentIntentId },
    });
    return saved;
  }

  /**
   * Admin queue accessor — returns concierge-priority requests first, sorted
   * by created_at desc within each priority band. Used by the existing
   * /admin/marketplace/requests endpoint when `priority=concierge`.
   */
  async listAdminByPriority(priority?: 'concierge' | 'standard') {
    const qb = this.requests
      .createQueryBuilder('r')
      .orderBy('r.priority', 'DESC')
      .addOrderBy('r.createdAt', 'DESC')
      .take(200);
    if (priority) {
      qb.where('r.priority = :priority', { priority });
    }
    return qb.getMany();
  }

  /**
   * R2-D-02 — consume one lead credit per quote submission. Pro brokers
   * pay the reduced rate (default 0). When credits aren't bound on this
   * deploy the call is a no-op so unit tests still pass.
   */
  private async consumeLeadCreditForQuote(
    ctx: RequestContext,
    match: MarketplaceBrokerMatchEntity,
  ): Promise<void> {
    if (!this.credits) return;
    let cost = Number(process.env.MARKETPLACE_LEAD_CREDIT_COST ?? 1);
    if (this.profiles) {
      const profile = await this.profiles.findOne({
        where: { id: match.brokerProfileId },
      });
      if (profile?.tier === 'pro') {
        cost = Number(process.env.MARKETPLACE_LEAD_CREDIT_COST_PRO ?? 0);
      }
    }
    if (cost <= 0) return;
    await this.credits.consume(ctx, {
      creditType: 'lead',
      amount: cost,
      eventType: 'marketplace_quote.submitted',
      description: `Submitted quote for match ${match.id}`,
    } as any);
  }

  /**
   * R2-D-01 — start a Pro listing subscription. Uses the existing Stripe
   * subscription checkout path (mode=subscription); the webhook below
   * flips MarketplaceBrokerProfile.tier to 'pro' once paid.
   *
   * Required env: STRIPE_PRO_PRICE_ID, MARKETPLACE_PRO_SUCCESS_URL,
   * MARKETPLACE_PRO_CANCEL_URL.
   */
  async startProSubscription(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    if (!this.stripe || !this.profiles) {
      throw new BadRequestException(
        'Stripe / profiles not configured on this deploy',
      );
    }
    const priceId = process.env.STRIPE_PRO_PRICE_ID;
    if (!priceId) {
      throw new BadRequestException('STRIPE_PRO_PRICE_ID is not configured');
    }
    const profile = await this.profiles.findOne({
      where: { organizationId: ctx.organizationId },
    });
    if (!profile) {
      throw new NotFoundException(
        'Broker profile required before subscribing to Pro',
      );
    }
    const baseUrl =
      process.env.API_BASE_URL ?? 'http://localhost:3100';
    const successUrl =
      process.env.MARKETPLACE_PRO_SUCCESS_URL ||
      `${baseUrl}/marketplace/pro/success`;
    const cancelUrl =
      process.env.MARKETPLACE_PRO_CANCEL_URL ||
      `${baseUrl}/marketplace/pro/cancel`;
    const session = await this.stripe.createFlexibleCheckoutSession({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&profile_id=${profile.id}`,
      cancel_url: `${cancelUrl}?profile_id=${profile.id}`,
      client_reference_id: profile.id,
      metadata: {
        brokerProfileId: profile.id,
        organizationId: ctx.organizationId,
        flow: 'pro_subscription',
      },
    });
    return {
      profileId: profile.id,
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  }

  /**
   * R2-D-01 — called from the marketplace Stripe webhook when a
   * checkout.session.completed event has metadata.flow=pro_subscription.
   * Flips the profile to Pro for the period reported by Stripe.
   */
  async promoteProSubscription(
    profileId: string,
    activeUntil: Date | null,
  ): Promise<MarketplaceBrokerProfileEntity | null> {
    if (!this.profiles) return null;
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) return null;
    profile.tier = 'pro';
    profile.tierActiveUntil = activeUntil;
    const saved = await this.profiles.save(profile);
    await this.audit.record({
      eventType: 'marketplace_profile.tier_promoted',
      organizationId: profile.organizationId,
      resourceType: 'marketplace_broker_profile',
      resourceId: profile.id,
      source: 'marketplace-stripe-webhook',
      metadata: { tier: 'pro', activeUntil: activeUntil?.toISOString() },
    });
    return saved;
  }

  /**
   * R2-D-05 — win-rate by commodity. For each candidate HTS chapter
   * surfaced across the caller's recent requests, returns the number of
   * quotes accepted vs total quotes. Powers the admin + broker analytics
   * dashboard.
   */
  async winRateByCommodity(
    organizationId: string,
    days = 90,
  ): Promise<
    Array<{ chapter: string; quotes: number; accepted: number; winRate: number }>
  > {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Pull quotes for this broker org + their request candidateHtsNumbers.
    const quotes = await this.quotes
      .createQueryBuilder('q')
      .leftJoinAndMapOne(
        'q.request',
        MarketplaceRequestEntity,
        'r',
        'r.id = q.requestId',
      )
      .where('q.brokerOrganizationId = :org', { org: organizationId })
      .andWhere('q.createdAt > :since', { since })
      .getMany();
    const byChapter = new Map<string, { quotes: number; accepted: number }>();
    for (const quote of quotes as Array<
      MarketplaceQuoteEntity & { request?: MarketplaceRequestEntity }
    >) {
      const chapters = new Set<string>();
      for (const hts of quote.request?.candidateHtsNumbers ?? []) {
        const ch = hts.replace(/\D/g, '').slice(0, 2);
        if (ch) chapters.add(ch);
      }
      if (chapters.size === 0) chapters.add('unknown');
      for (const ch of chapters) {
        const bucket = byChapter.get(ch) ?? { quotes: 0, accepted: 0 };
        bucket.quotes += 1;
        if (quote.status === 'accepted') bucket.accepted += 1;
        byChapter.set(ch, bucket);
      }
    }
    return Array.from(byChapter.entries())
      .map(([chapter, { quotes, accepted }]) => ({
        chapter,
        quotes,
        accepted,
        winRate: quotes > 0 ? accepted / quotes : 0,
      }))
      .sort((a, b) => b.quotes - a.quotes);
  }

  private redactIfHidden(message: MarketplaceMessageEntity) {
    if (!message.hidden) return message;
    return {
      ...message,
      body: '[Message hidden by moderator]',
      attachments: null,
      hiddenReason: message.hiddenReason ?? null,
    } as MarketplaceMessageEntity;
  }

  async consentToFullPacket(
    ctx: RequestContext,
    conversationId: string,
    dto: ConsentToFullPacketDto,
  ) {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.businessOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Only business can grant consent');
    }
    const now = new Date();
    conversation.fullPacketConsented = dto.consent;
    conversation.fullPacketConsentedAt = dto.consent ? now : null;
    conversation.fullPacketConsentedByUserId = dto.consent ? ctx.userId : null;
    // R1-D-04 — append timeline entry. Idempotent toggles (consent already
    // matches) still record an event so revocation→re-grant patterns are
    // visible to auditors.
    conversation.consentHistory = [
      ...(conversation.consentHistory ?? []),
      { consent: dto.consent, at: now.toISOString(), byUserId: ctx.userId },
    ];
    await this.conversations.save(conversation);
    await this.audit.record({
      eventType: 'marketplace_conversation.full_packet_consent',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_conversation',
      resourceId: conversation.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { consent: dto.consent },
    });
    return conversation;
  }

  private async getOwnedRequest(ctx: RequestContext, id: string) {
    const request = await this.requests.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.requestingOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException('Request belongs to another tenant');
    }
    return request;
  }

  private resolveSenderRole(
    ctx: RequestContext,
    conversation: MarketplaceConversationEntity,
  ): 'broker' | 'business' | null {
    if (ctx.organizationId === conversation.brokerOrganizationId) {
      return 'broker';
    }
    if (ctx.organizationId === conversation.businessOrganizationId) {
      return 'business';
    }
    return null;
  }

  private brokerVisibleRequest(
    request: MarketplaceRequestEntity,
    conversation?: MarketplaceConversationEntity | null,
  ) {
    const fullPacket = conversation?.fullPacketConsented === true;
    return {
      id: request.id,
      title: request.title,
      commoditySummary: fullPacket
        ? request.commoditySummary
        : this.summaryTeaser(request.commoditySummary),
      originCountry: request.originCountry,
      destinationCountry: request.destinationCountry,
      portOfEntry: request.portOfEntry,
      mode: request.mode,
      serviceCategories: request.serviceCategories,
      regulatoryFlags: request.regulatoryFlags,
      candidateHtsNumbers: request.candidateHtsNumbers,
      readinessScore: request.readinessScore,
      readinessBreakdown: request.readinessBreakdown,
      shipmentValue: fullPacket ? request.shipmentValue : null,
      shipmentCurrency: request.shipmentCurrency,
      shipmentVolume: request.shipmentVolume,
      deadline: request.deadline,
      status: request.status,
      visibilityMode: request.visibilityMode,
      fullPacketConsented: fullPacket,
      createdAt: request.createdAt,
    };
  }

  private summaryTeaser(summary: string | null): string {
    if (!summary) return '';
    return summary.length <= 200 ? summary : `${summary.slice(0, 200)}…`;
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated context required');
    }
  }

  /**
   * R1-A-02 polling endpoint payload — returns messages newer than `since`
   * (ISO timestamp). The controller wraps this in SSE; clients that want a
   * plain JSON poll can call the GET endpoint directly.
   */
  async pollMessages(
    ctx: RequestContext,
    conversationId: string,
    since?: Date | null,
  ) {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (!this.resolveSenderRole(ctx, conversation)) {
      throw new ForbiddenException('Not a participant of this conversation');
    }
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.conversationId = :id', { id: conversationId })
      .orderBy('m.createdAt', 'ASC')
      .take(200);
    if (since) {
      qb.andWhere('m.createdAt > :since', { since });
    }
    const rows = await qb.getMany();
    const latest = rows.length
      ? rows[rows.length - 1].createdAt
      : (since ?? null);
    return {
      rows: rows.map((r) => this.redactIfHidden(r)),
      latest,
      hasMore: rows.length === 200,
    };
  }

  /**
   * R1-A-01 — issue a tenant-scoped read URL for a single attachment on a
   * message. Caller must be a conversation participant, the attachment must
   * be revealed (sharedFull=true or sender's own attachment), and the
   * storage key must belong to a participant org.
   */
  async signMessageAttachment(
    ctx: RequestContext,
    conversationId: string,
    messageId: string,
    storageKey: string,
  ) {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const role = this.resolveSenderRole(ctx, conversation);
    if (!role) {
      throw new ForbiddenException('Not a participant of this conversation');
    }
    const message = await this.messages.findOne({
      where: { id: messageId, conversationId },
    });
    if (!message) throw new NotFoundException('Message not found');
    const attachment = (message.attachments ?? []).find(
      (a) => a.storageKey === storageKey,
    );
    if (!attachment) throw new NotFoundException('Attachment not found');
    const senderIsCaller = message.senderOrganizationId === ctx.organizationId;
    if (!senderIsCaller && attachment.sharedFull !== true) {
      throw new ForbiddenException(
        'Attachment is not yet shared with this party (consent required)',
      );
    }
    const ownerOrgId = this.storage.keyBelongsToTenant(
      storageKey,
      conversation.brokerOrganizationId,
    )
      ? conversation.brokerOrganizationId
      : this.storage.keyBelongsToTenant(
            storageKey,
            conversation.businessOrganizationId,
          )
        ? conversation.businessOrganizationId
        : null;
    if (!ownerOrgId) {
      throw new ForbiddenException(
        'Attachment storage key does not belong to any conversation participant',
      );
    }
    const url = await this.storage.createReadUrl(storageKey, {
      organizationId: ownerOrgId,
      fileName: attachment.fileName,
      expiresInSeconds: 300,
    });
    return { url, provider: this.storage.providerKey };
  }
}
