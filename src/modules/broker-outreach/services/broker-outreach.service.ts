import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import type { FindOptionsWhere, Repository } from 'typeorm';
import { ApiKeyService } from '../../api-keys/services/api-key.service';
import { AuditService } from '../../audit/services/audit.service';
import { AuthService } from '../../auth/services/auth.service';
import {
  BrokerOutreachCampaignEntity,
  BrokerOutreachInviteEntity,
  BrokerOutreachLeadEntity,
} from '../entities';
import {
  BulkUpsertBrokerOutreachLeadsDto,
  ClaimBrokerOutreachInviteDto,
  CreateBrokerOutreachCampaignDto,
  CreateBrokerOutreachInviteDto,
  DiscoverGoogleBrokerLeadsDto,
  DiscoverOsmBrokerLeadsDto,
  DraftBrokerOutreachEmailDto,
  OSM_NAME_CATEGORIES,
  UpsertBrokerOutreachLeadDto,
} from '../dto/broker-outreach.dto';
import { TelemetryService } from '../../observability/telemetry.service';
import { BrokerOutreachDiscoveryLedgerService } from './broker-outreach-discovery-ledger.service';
import { BrokerOutreachEmailService } from './broker-outreach-email.service';
import { GoogleSearchScraperService } from './google-search-scraper.service';

export interface InviteCreationResult {
  invite: Omit<BrokerOutreachInviteEntity, 'tokenHash'>;
  token: string;
  claimUrl: string;
  emailDraft: { subject: string; body: string; claimUrl: string };
  send?: {
    status: string;
    provider: string;
    messageId?: string | null;
  } | null;
}

@Injectable()
export class BrokerOutreachService {
  private readonly logger = new Logger(BrokerOutreachService.name);

  constructor(
    @InjectRepository(BrokerOutreachLeadEntity)
    private readonly leads: Repository<BrokerOutreachLeadEntity>,
    @InjectRepository(BrokerOutreachCampaignEntity)
    private readonly campaigns: Repository<BrokerOutreachCampaignEntity>,
    @InjectRepository(BrokerOutreachInviteEntity)
    private readonly invites: Repository<BrokerOutreachInviteEntity>,
    private readonly auth: AuthService,
    private readonly apiKeys: ApiKeyService,
    @Optional()
    private readonly googleSearch: GoogleSearchScraperService | null = null,
    @Optional()
    private readonly discoveryLedger: BrokerOutreachDiscoveryLedgerService | null = null,
    @Optional()
    private readonly email: BrokerOutreachEmailService | null = null,
    @Optional()
    private readonly audit: AuditService | null = null,
    @Optional()
    private readonly telemetry: TelemetryService | null = null,
  ) {}

  private async auditRecord(
    eventType: string,
    actor: string,
    resourceId: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.audit) return;
    await this.audit.record({
      eventType,
      actorUserId: actor,
      resourceType: 'broker_outreach',
      resourceId,
      source: 'broker-outreach',
      metadata,
    });
  }

  async listLeads(filter: {
    status?: string;
    sourceProvider?: string;
    limit?: number;
  } = {}): Promise<BrokerOutreachLeadEntity[]> {
    return this.leads.find({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.sourceProvider ? { sourceProvider: filter.sourceProvider } : {}),
      },
      order: { createdAt: 'DESC' },
      take: Math.max(1, Math.min(500, filter.limit ?? 100)),
    });
  }

  async bulkUpsertLeads(
    input: BulkUpsertBrokerOutreachLeadsDto,
    actor = 'system',
  ): Promise<{
    inserted: number;
    updated: number;
    leads: BrokerOutreachLeadEntity[];
  }> {
    let inserted = 0;
    let updated = 0;
    const saved: BrokerOutreachLeadEntity[] = [];
    for (const lead of input.leads) {
      const result = await this.upsertLead(lead, actor);
      if (result.created) inserted += 1;
      else updated += 1;
      saved.push(result.lead);
    }
    await this.auditRecord('broker_outreach.leads_imported', actor, null, {
      inserted,
      updated,
      total: input.leads.length,
    });
    return { inserted, updated, leads: saved };
  }

  async upsertLead(
    input: UpsertBrokerOutreachLeadDto,
    actor = 'system',
  ): Promise<{ created: boolean; lead: BrokerOutreachLeadEntity }> {
    const existing = await this.findExistingLead(input);
    const now = new Date();
    const fields = this.mapLeadFields(input, actor, now);
    if (existing) {
      // Preserve primary source provenance: once a lead has been recorded
      // with a sourceProvider+externalId, a later discovery from a
      // different provider must NOT overwrite the original provenance.
      // Subsequent observations are appended to metadata.sourceHistory.
      const preservedSourceProvider = existing.sourceProvider;
      const preservedSourceExternalId = existing.sourceExternalId;
      const sourceChanged =
        (existing.sourceProvider && existing.sourceProvider !== input.sourceProvider) ||
        (existing.sourceExternalId &&
          existing.sourceExternalId !== input.sourceExternalId);
      const sourceHistory = Array.isArray(
        (existing.metadata as any)?.sourceHistory,
      )
        ? ((existing.metadata as any).sourceHistory as Array<Record<string, unknown>>).slice()
        : [];
      if (sourceChanged) {
        sourceHistory.push({
          provider: input.sourceProvider,
          externalId: input.sourceExternalId ?? null,
          observedAt: now.toISOString(),
          observedBy: actor,
        });
      }
      Object.assign(existing, fields, {
        sourceProvider: preservedSourceProvider,
        sourceExternalId: preservedSourceExternalId,
        metadata: {
          ...(fields.metadata ?? {}),
          ...(existing.metadata ?? {}),
          ...(sourceChanged ? { sourceHistory } : {}),
        },
        createdBy: existing.createdBy,
        updatedBy: actor,
        lastImportedAt: now,
      });
      return { created: false, lead: await this.leads.save(existing) };
    }

    const lead = this.leads.create({
      ...fields,
      createdBy: actor,
      updatedBy: actor,
      lastImportedAt: now,
      lastContactedAt: null,
      convertedAt: null,
    } as BrokerOutreachLeadEntity);
    return { created: true, lead: await this.leads.save(lead) };
  }

  async listCampaigns(status?: string): Promise<BrokerOutreachCampaignEntity[]> {
    return this.campaigns.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async createCampaign(
    input: CreateBrokerOutreachCampaignDto,
    actor = 'system',
  ): Promise<BrokerOutreachCampaignEntity> {
    const campaign = this.campaigns.create({
      name: input.name,
      status: input.status ?? 'draft',
      audience: input.audience ?? null,
      objective: input.objective ?? null,
      emailSubject: input.emailSubject ?? null,
      emailBody: input.emailBody ?? null,
      aiPrompt: input.aiPrompt ?? null,
      metrics: { leadsImported: 0, invitesCreated: 0, claims: 0 },
      createdBy: actor,
      updatedBy: actor,
    });
    return this.campaigns.save(campaign);
  }

  async draftEmail(input: DraftBrokerOutreachEmailDto): Promise<{
    subject: string;
    body: string;
    claimUrl: string;
  }> {
    const lead = input.leadId
      ? await this.requireLead(input.leadId)
      : null;
    const campaign = input.campaignId
      ? await this.requireCampaign(input.campaignId)
      : null;
    const companyName = lead?.companyName ?? 'your team';
    const claimUrl = input.claimUrl ?? '{{claimUrl}}';
    const subject =
      campaign?.emailSubject ??
      `A faster broker workspace for ${companyName}`;
    const body =
      campaign?.emailBody ??
      [
        `Hi ${companyName},`,
        '',
        'DigiTrend is opening a broker workspace for qualified customs brokers, freight forwarders, exporters, and importers that need one place to manage classification, landed-cost checks, document packets, marketplace requests, and cross-border handoffs.',
        '',
        'Your invite is ready. The link creates a trial workspace with your company profile prefilled so your team can evaluate the broker marketplace and fulfillment workflow in a few seconds.',
        '',
        claimUrl,
        '',
        'Best,',
        'The DigiTrend team',
      ].join('\n');

    return {
      subject: personalize(subject, lead, claimUrl),
      body: personalize(body, lead, claimUrl),
      claimUrl,
    };
  }

  async createInvite(
    input: CreateBrokerOutreachInviteDto,
    actor = 'system',
  ): Promise<InviteCreationResult> {
    const lead = await this.requireLead(input.leadId);
    const campaign = input.campaignId
      ? await this.requireCampaign(input.campaignId)
      : null;
    const email = (input.email ?? lead.contactEmail ?? '').toLowerCase().trim();
    if (!email) {
      throw new BadRequestException('Invite email is required');
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays ?? 14));

    const invite = this.invites.create({
      leadId: lead.id,
      campaignId: campaign?.id ?? null,
      email,
      tokenHash,
      status: 'created',
      expiresAt,
      sentAt: null,
      openedAt: null,
      claimedAt: null,
      claimedOrganizationId: null,
      claimedUserId: null,
      metadata: { createdVia: 'admin' },
      createdBy: actor,
    });
    const saved = await this.invites.save(invite);

    lead.status = lead.status === 'converted' ? lead.status : 'invited';
    lead.lastContactedAt = new Date();
    lead.updatedBy = actor;
    await this.leads.save(lead);

    const claimUrl = this.buildClaimUrl(token);
    const emailDraft = await this.draftEmail({
      leadId: lead.id,
      campaignId: campaign?.id,
      claimUrl,
    });

    // Hand off to the email transport when bound. The log-only default
    // makes this safe to call from tests; real providers swap in later.
    let send: { status: string; provider: string; messageId?: string | null } | null = null;
    if (this.email) {
      send = await this.email.send({
        to: email,
        subject: emailDraft.subject,
        body: emailDraft.body,
        campaignId: campaign?.id ?? null,
        leadId: lead.id,
        inviteId: saved.id,
        metadata: { claimUrl },
      });
      if (send.status === 'sent') {
        saved.status = 'sent';
        saved.sentAt = new Date();
        saved.metadata = {
          ...(saved.metadata ?? {}),
          emailSend: {
            provider: send.provider,
            messageId: send.messageId ?? null,
            sentAt: saved.sentAt.toISOString(),
          },
        };
        await this.invites.save(saved);
      } else if (send.status === 'suppressed') {
        saved.metadata = {
          ...(saved.metadata ?? {}),
          emailSend: {
            provider: send.provider,
            status: 'suppressed',
            reason: 'address suppressed',
            attemptedAt: new Date().toISOString(),
          },
        };
        await this.invites.save(saved);
      }
    }

    await this.auditRecord('broker_outreach.invite_created', actor, saved.id, {
      leadId: lead.id,
      email,
      campaignId: campaign?.id ?? null,
      sendStatus: send?.status ?? null,
    });
    this.telemetry?.countEvent('broker_outreach_invites_total', {
      status: saved.status,
    });

    return {
      invite: stripTokenHash(saved),
      token,
      claimUrl,
      emailDraft,
      send,
    };
  }

  async discoverFromOsm(
    input: DiscoverOsmBrokerLeadsDto,
    actor = 'system',
  ): Promise<{
    provider: 'osm';
    runId: string | null;
    fetched: number;
    inserted: number;
    updated: number;
    leads: BrokerOutreachLeadEntity[];
  }> {
    const bbox = validateOsmBbox(input.bbox);
    const limit = Math.max(1, Math.min(250, input.limit ?? 100));
    const categories = sanitizeNameCategories(input.nameCategories);
    const run = await this.discoveryLedger?.beginRun({
      provider: 'osm',
      input: { bbox, limit, categories },
      triggeredBy: actor,
    });
    try {
      const query = buildOverpassQuery({
        bbox,
        nameCategories: categories,
        limit,
      });
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (!res.ok) {
        throw new BadRequestException(`OSM Overpass returned HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        elements?: Array<Record<string, any>>;
      };
      const candidates = (json.elements ?? [])
        .map((element) => mapOsmElementToLead(element))
        .filter((lead): lead is UpsertBrokerOutreachLeadDto => !!lead)
        .slice(0, limit);
      const tally = await this.upsertCandidatesWithLedger(
        run?.id ?? null,
        candidates,
        actor,
      );
      await this.discoveryLedger?.finishRun(run!.id, {
        fetched: json.elements?.length ?? 0,
        inserted: tally.inserted,
        updated: tally.updated,
        failed: tally.failed,
      });
      return {
        provider: 'osm',
        runId: run?.id ?? null,
        fetched: json.elements?.length ?? 0,
        inserted: tally.inserted,
        updated: tally.updated,
        leads: tally.leads,
      };
    } catch (e: any) {
      if (run?.id && this.discoveryLedger) {
        await this.discoveryLedger.finishRun(run.id, {
          fetched: 0,
          inserted: 0,
          updated: 0,
          failed: 0,
          status: 'failed',
          errorMessage: e?.message ?? String(e),
        });
      }
      throw e;
    }
  }

  /**
   * Discover broker leads via a public Google Search scrape. Replaces
   * the previous paid-API discovery path; no paid API key is required.
   * Gated by BROKER_OUTREACH_GOOGLE_SCRAPER_ENABLED — see
   * GoogleSearchScraperService for details.
   */
  async discoverFromGoogleSearch(
    input: DiscoverGoogleBrokerLeadsDto,
    actor = 'system',
  ): Promise<{
    provider: 'google-search';
    runId: string | null;
    fetched: number;
    inserted: number;
    updated: number;
    leads: BrokerOutreachLeadEntity[];
  }> {
    if (!this.googleSearch) {
      throw new BadRequestException(
        'Google Search scraper not configured on this deploy',
      );
    }
    const run = await this.discoveryLedger?.beginRun({
      provider: 'google-search',
      input: {
        textQuery: input.textQuery,
        pageSize: input.pageSize,
        languageCode: input.languageCode,
        countryCode: input.countryCode,
      },
      triggeredBy: actor,
    });
    try {
      const results = await this.googleSearch.search({
        query: input.textQuery,
        limit: input.pageSize ?? 10,
        languageCode: input.languageCode,
        countryCode: input.countryCode,
      });
      const candidates = results
        .map((r) => mapGoogleSearchResultToLead(r))
        .filter((lead): lead is UpsertBrokerOutreachLeadDto => !!lead);
      const tally = await this.upsertCandidatesWithLedger(
        run?.id ?? null,
        candidates,
        actor,
      );
      await this.discoveryLedger?.finishRun(run!.id, {
        fetched: results.length,
        inserted: tally.inserted,
        updated: tally.updated,
        failed: tally.failed,
      });
      return {
        provider: 'google-search',
        runId: run?.id ?? null,
        fetched: results.length,
        inserted: tally.inserted,
        updated: tally.updated,
        leads: tally.leads,
      };
    } catch (e: any) {
      if (run?.id && this.discoveryLedger) {
        await this.discoveryLedger.finishRun(run.id, {
          fetched: 0,
          inserted: 0,
          updated: 0,
          failed: 0,
          status: 'failed',
          errorMessage: e?.message ?? String(e),
        });
      }
      throw e;
    }
  }

  /**
   * Upsert a batch of discovered candidates and persist a ledger result
   * row per candidate when the ledger is available. Used by both
   * discovery paths so the ledger stays in lock-step with the lead
   * write.
   */
  private async upsertCandidatesWithLedger(
    runId: string | null,
    candidates: UpsertBrokerOutreachLeadDto[],
    actor: string,
  ): Promise<{
    inserted: number;
    updated: number;
    failed: number;
    leads: BrokerOutreachLeadEntity[];
  }> {
    let inserted = 0;
    let updated = 0;
    let failed = 0;
    const leads: BrokerOutreachLeadEntity[] = [];
    for (const candidate of candidates) {
      try {
        const result = await this.upsertLead(candidate, actor);
        if (result.created) inserted += 1;
        else updated += 1;
        leads.push(result.lead);
        if (runId && this.discoveryLedger) {
          await this.discoveryLedger.recordResult(runId, {
            status: result.created ? 'ingested' : 'updated',
            externalId: candidate.sourceExternalId ?? null,
            companyName: candidate.companyName,
            websiteUrl: candidate.websiteUrl ?? null,
            lead: result.lead,
          });
        }
      } catch (e: any) {
        failed += 1;
        this.logger.warn(
          `outreach.discover.upsert.failed name="${candidate.companyName}": ${e?.message ?? e}`,
        );
        if (runId && this.discoveryLedger) {
          await this.discoveryLedger.recordResult(runId, {
            status: 'failed',
            externalId: candidate.sourceExternalId ?? null,
            companyName: candidate.companyName,
            websiteUrl: candidate.websiteUrl ?? null,
            errorMessage: e?.message ?? String(e),
          });
        }
      }
    }
    return { inserted, updated, failed, leads };
  }

  async listInvites(filter: {
    leadId?: string;
    campaignId?: string;
    status?: string;
    limit?: number;
  } = {}): Promise<Array<Omit<BrokerOutreachInviteEntity, 'tokenHash'>>> {
    const where: FindOptionsWhere<BrokerOutreachInviteEntity> = {
      ...(filter.leadId ? { leadId: filter.leadId } : {}),
      ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const rows = await this.invites.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.max(1, Math.min(500, filter.limit ?? 100)),
    });
    return rows.map(stripTokenHash);
  }

  /**
   * Read-only invite preview. Pure GET — does NOT mutate invite state.
   * The previous version flipped `status='opened'` here, which let email
   * scanners, link unfurlers and browser prefetch silently mark invites
   * as opened. The client now calls POST `/broker-outreach/invites/:token/opened`
   * (via `recordInviteOpened`) from a post-render beacon to record opens.
   */
  async previewInvite(token: string): Promise<{
    invite: Omit<BrokerOutreachInviteEntity, 'tokenHash'>;
    companyName: string;
    signupDefaults: {
      email: string;
      company: {
        name: string;
        websiteUrl: string | null;
        country: string | null;
        integrationType: string;
        platform: string | null;
      };
    };
  }> {
    const invite = await this.requireInviteByToken(token);
    const lead = await this.requireLead(invite.leadId);
    return {
      invite: stripTokenHash(invite),
      companyName: lead.companyName,
      signupDefaults: {
        email: invite.email,
        company: {
          name: lead.companyName,
          websiteUrl: lead.websiteUrl,
          country: lead.country,
          integrationType: 'broker-outreach',
          platform: lead.businessCategory,
        },
      },
    };
  }

  /**
   * Record that a human (not an email scanner) opened the invite. Called
   * from a beacon after the invite preview page hydrates — see
   * BrokerOutreachPublicController.recordInviteOpened.
   */
  async recordInviteOpened(token: string): Promise<{ opened: boolean }> {
    const invite = await this.requireInviteByToken(token);
    if (invite.status === 'created' || invite.status === 'sent') {
      invite.status = 'opened';
      invite.openedAt = new Date();
      await this.invites.save(invite);
      return { opened: true };
    }
    return { opened: false };
  }

  /**
   * Claim an outreach invite into a trial account.
   *
   * Recovery: the steps below are deliberately staged so that a retry
   * after a partial failure can resume rather than re-create the user.
   *   1. validate token + lead + email
   *   2. resolve the trial user (create if missing, reuse if pre-claim)
   *   3. record `claimedOrganizationId`/`claimedUserId` on the invite as
   *      soon as the user exists — even if API-key issuance fails the
   *      retry can pick up where it left off.
   *   4. issue the trial API key (idempotent: reuses an existing key if
   *      the invite already records one).
   *   5. flip invite.status='claimed' + lead.status='converted'.
   */
  async claimInvite(token: string, input: ClaimBrokerOutreachInviteDto) {
    const invite = await this.requireInviteByToken(token);
    const lead = await this.requireLead(invite.leadId);
    const normalizedEmail = input.email.toLowerCase().trim();
    if (normalizedEmail !== invite.email) {
      throw new BadRequestException('invite must be claimed with the invited email');
    }

    // Step 2 — resolve trial user (recovery: reuse previously-created
    // account if a prior attempt got past register but failed before
    // the invite was finalized).
    let user: { id: string; organizationId: string };
    if (invite.claimedUserId && invite.claimedOrganizationId) {
      user = {
        id: invite.claimedUserId,
        organizationId: invite.claimedOrganizationId,
      };
      this.logger.log(
        `outreach.claim.resume invite=${invite.id} user=${user.id} org=${user.organizationId}`,
      );
    } else {
      try {
        const created = await this.auth.register(
          normalizedEmail,
          input.password,
          input.firstName,
          input.lastName,
          null,
          {
            name: lead.companyName,
            websiteUrl: lead.websiteUrl ?? undefined,
            country: lead.country ?? undefined,
            integrationType: 'broker-outreach',
            platform: lead.businessCategory ?? undefined,
          },
        );
        user = { id: created.id, organizationId: created.organizationId };
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? '').toLowerCase();
        if (msg.includes('email') && (msg.includes('exists') || msg.includes('already'))) {
          throw new BadRequestException(
            'An account already exists for the invited email. Sign in and use the trial activation page to claim this invite.',
          );
        }
        throw e;
      }
    }

    // Step 3 — persist the claim ownership immediately, so a crash here
    // is recoverable. Status stays `opened` until the API key is issued.
    invite.claimedUserId = user.id;
    invite.claimedOrganizationId = user.organizationId;
    await this.invites.save(invite);

    // Step 4 — issue the API key. Idempotent: if a prior attempt set
    // a metadata.apiKeyId we still hand the caller a fresh key — they
    // can revoke the previous one. (Plaintext is one-shot.)
    const generated = await this.apiKeys.generateApiKey({
      organizationId: user.organizationId,
      name: 'Broker Trial API Key',
      description: 'Auto-generated from broker outreach invite claim',
      environment: 'live',
      permissions: ['hts:lookup', 'hts:calculate', 'kb:query', 'broker:marketplace'],
      createdBy: user.id,
    });
    const auth = await this.auth.login({ id: user.id });

    // Step 5 — finalize.
    invite.status = 'claimed';
    invite.claimedAt = new Date();
    invite.metadata = {
      ...(invite.metadata ?? {}),
      apiKeyId: generated.apiKey?.id ?? null,
    };
    await this.invites.save(invite);

    lead.status = 'converted';
    lead.convertedAt = new Date();
    await this.leads.save(lead);

    await this.auditRecord(
      'broker_outreach.invite_claimed',
      user.id,
      invite.id,
      {
        leadId: lead.id,
        organizationId: user.organizationId,
        email: normalizedEmail,
      },
    );
    this.telemetry?.countEvent('broker_outreach_invites_total', {
      status: 'claimed',
    });

    return {
      ...auth,
      organizationId: user.organizationId,
      apiKey: generated.plainTextKey,
      invite: stripTokenHash(invite),
    };
  }

  private async findExistingLead(
    input: UpsertBrokerOutreachLeadDto,
  ): Promise<BrokerOutreachLeadEntity | null> {
    const domain = normalizeDomain(input.websiteUrl, input.contactEmail);
    const candidates: FindOptionsWhere<BrokerOutreachLeadEntity>[] = [];
    if (input.sourceExternalId) {
      candidates.push({
        sourceProvider: input.sourceProvider,
        sourceExternalId: input.sourceExternalId,
      });
    }
    if (domain) {
      candidates.push({ domain });
    }
    if (input.contactEmail) {
      candidates.push({ contactEmail: input.contactEmail.toLowerCase().trim() });
    }
    if (candidates.length === 0) return null;
    return this.leads.findOne({ where: candidates });
  }

  private mapLeadFields(
    input: UpsertBrokerOutreachLeadDto,
    actor: string,
    now: Date,
  ): Partial<BrokerOutreachLeadEntity> {
    const domain = normalizeDomain(input.websiteUrl, input.contactEmail);
    return {
      companyName: input.companyName.trim(),
      sourceProvider: input.sourceProvider,
      sourceExternalId: input.sourceExternalId?.trim() ?? null,
      businessCategory: input.businessCategory?.trim() ?? null,
      websiteUrl: input.websiteUrl?.trim() ?? null,
      domain,
      contactEmail: input.contactEmail?.toLowerCase().trim() ?? null,
      contactPhone: input.contactPhone?.trim() ?? null,
      country: input.country?.trim() ?? null,
      region: input.region?.trim() ?? null,
      city: input.city?.trim() ?? null,
      address: input.address?.trim() ?? null,
      latitude: input.latitude === undefined ? null : input.latitude.toFixed(7),
      longitude: input.longitude === undefined ? null : input.longitude.toFixed(7),
      status: input.status ?? 'new',
      score: (input.score ?? leadScore(input)).toFixed(2),
      tags: [...new Set(input.tags ?? [])],
      metadata: {
        ...(input.metadata ?? {}),
        importedAt: now.toISOString(),
      },
      updatedBy: actor,
    };
  }

  private async requireLead(id: string): Promise<BrokerOutreachLeadEntity> {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException(`outreach lead not found: ${id}`);
    return lead;
  }

  private async requireCampaign(id: string): Promise<BrokerOutreachCampaignEntity> {
    const campaign = await this.campaigns.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException(`outreach campaign not found: ${id}`);
    return campaign;
  }

  private async requireInviteByToken(
    token: string,
    options: { markOpened?: boolean } = {},
  ): Promise<BrokerOutreachInviteEntity> {
    const invite = await this.invites.findOne({
      where: { tokenHash: hashToken(token) },
    });
    if (!invite) throw new NotFoundException('invite not found');
    const now = new Date();
    if (invite.status === 'revoked') {
      throw new BadRequestException('invite has been revoked');
    }
    if (invite.status === 'claimed') {
      throw new BadRequestException('invite has already been claimed');
    }
    if (invite.expiresAt.getTime() < now.getTime()) {
      invite.status = 'expired';
      await this.invites.save(invite);
      throw new BadRequestException('invite has expired');
    }
    if (options.markOpened && invite.status === 'created') {
      invite.status = 'opened';
      invite.openedAt = now;
      await this.invites.save(invite);
    }
    return invite;
  }

  private buildClaimUrl(token: string): string {
    const base = process.env.FRONTEND_URL || 'http://localhost:4200';
    const url = new URL('/broker-outreach/invite', base);
    url.searchParams.set('token', token);
    return url.toString();
  }
}

function normalizeDomain(
  websiteUrl: string | undefined,
  email: string | undefined,
): string | null {
  if (websiteUrl) {
    try {
      const url = new URL(websiteUrl);
      return url.hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return null;
    }
  }
  const emailDomain = email?.split('@')[1]?.trim().toLowerCase();
  return emailDomain || null;
}

function leadScore(input: UpsertBrokerOutreachLeadDto): number {
  let score = 30;
  if (input.contactEmail) score += 25;
  if (input.websiteUrl) score += 15;
  if (input.businessCategory?.match(/broker|customs|freight|forward/i)) score += 20;
  if (input.country) score += 5;
  if (input.latitude !== undefined && input.longitude !== undefined) score += 5;
  return Math.min(100, score);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function stripTokenHash(
  invite: BrokerOutreachInviteEntity,
): Omit<BrokerOutreachInviteEntity, 'tokenHash'> {
  const { tokenHash: _tokenHash, ...safe } = invite;
  return safe;
}

function personalize(
  template: string,
  lead: BrokerOutreachLeadEntity | null,
  claimUrl: string,
): string {
  return template
    .replace(/\{\{companyName\}\}/g, lead?.companyName ?? 'your team')
    .replace(/\{\{claimUrl\}\}/g, claimUrl)
    .replace(/\{\{city\}\}/g, lead?.city ?? '')
    .replace(/\{\{country\}\}/g, lead?.country ?? '')
    .trim();
}

/**
 * Validate an OSM bbox before passing it to Overpass. Public Overpass
 * servers will charge huge query cost for very large bboxes so we cap
 * the area; orientation is also enforced.
 */
const OSM_BBOX_MAX_AREA_DEG2 = Number(
  process.env.OSM_BBOX_MAX_AREA_DEG2 ?? 25,
);

export function validateOsmBbox(
  bbox: number[],
): [number, number, number, number] {
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new BadRequestException('bbox must be [south, west, north, east] numbers');
  }
  const [south, west, north, east] = bbox;
  if (south < -90 || south > 90 || north < -90 || north > 90) {
    throw new BadRequestException('latitude must be in [-90, 90]');
  }
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    throw new BadRequestException('longitude must be in [-180, 180]');
  }
  if (south >= north) {
    throw new BadRequestException('south must be < north');
  }
  if (west >= east) {
    throw new BadRequestException('west must be < east');
  }
  const area = (north - south) * (east - west);
  if (area > OSM_BBOX_MAX_AREA_DEG2) {
    throw new BadRequestException(
      `bbox area ${area.toFixed(2)}deg² exceeds cap ${OSM_BBOX_MAX_AREA_DEG2}deg²`,
    );
  }
  return [south, west, north, east];
}

export function sanitizeNameCategories(
  input: string[] | undefined,
): string[] {
  const allowed = new Set(OSM_NAME_CATEGORIES as readonly string[]);
  const requested = (input ?? []).filter((c) => allowed.has(c));
  if (requested.length > 0) return requested;
  return [...OSM_NAME_CATEGORIES];
}

function buildOverpassQuery(input: {
  bbox: [number, number, number, number];
  nameCategories: string[];
  limit: number;
}): string {
  const bbox = input.bbox.join(',');
  // Build an alternation regex from the allowlisted categories. Each
  // category is alphanumeric (validated upstream) so no escaping is
  // necessary; we still strip non-word characters defensively.
  const regex = input.nameCategories
    .map((c) => c.replace(/[^a-z]/gi, ''))
    .filter(Boolean)
    .join('|');
  return `
[out:json][timeout:25];
(
  node["name"~"${regex}",i](${bbox});
  way["name"~"${regex}",i](${bbox});
  relation["name"~"${regex}",i](${bbox});
  node["office"~"^(logistics|shipping|company)$"](${bbox});
  way["office"~"^(logistics|shipping|company)$"](${bbox});
  relation["office"~"^(logistics|shipping|company)$"](${bbox});
);
out center tags ${input.limit};
`;
}

function mapOsmElementToLead(
  element: Record<string, any>,
): UpsertBrokerOutreachLeadDto | null {
  const tags = (element.tags ?? {}) as Record<string, string>;
  const name = tags.name?.trim();
  if (!name) return null;
  const lat = typeof element.lat === 'number' ? element.lat : element.center?.lat;
  const lon = typeof element.lon === 'number' ? element.lon : element.center?.lon;
  return {
    companyName: name,
    sourceProvider: 'osm',
    sourceExternalId: `${element.type}/${element.id}`,
    businessCategory:
      tags.office ??
      tags.shop ??
      tags.amenity ??
      tags.craft ??
      tags['company:type'] ??
      'trade_services',
    websiteUrl: tags.website ?? tags['contact:website'],
    contactEmail: tags.email ?? tags['contact:email'],
    contactPhone: tags.phone ?? tags['contact:phone'],
    country: tags['addr:country'],
    region: tags['addr:state'] ?? tags['addr:province'],
    city: tags['addr:city'],
    address: [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:city'],
      tags['addr:state'] ?? tags['addr:province'],
      tags['addr:postcode'],
      tags['addr:country'],
    ]
      .filter(Boolean)
      .join(', '),
    latitude: typeof lat === 'number' ? lat : undefined,
    longitude: typeof lon === 'number' ? lon : undefined,
    tags: ['osm', 'discovered'],
    metadata: { osmTags: tags },
  };
}

function mapGoogleSearchResultToLead(
  result: { title: string; url: string; snippet: string | null; displayedHost: string | null },
): UpsertBrokerOutreachLeadDto | null {
  const title = result.title?.trim();
  if (!title || !result.url) return null;
  let websiteUrl: string | undefined;
  try {
    const u = new URL(result.url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    websiteUrl = `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
  const companyName = title.split(/[|\-–—]\s*/)[0].trim() || title;
  return {
    companyName: companyName.slice(0, 255),
    sourceProvider: 'google',
    sourceExternalId: result.url,
    businessCategory: 'trade_services',
    websiteUrl,
    tags: ['google-search', 'discovered'],
    metadata: {
      googleSearch: {
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        displayedHost: result.displayedHost,
      },
      complianceNote:
        'POC scraper — review Google ToS and respect robots.txt before production use.',
    },
  };
}
