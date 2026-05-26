import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import {
  BrokerOutreachCampaignEntity,
  BrokerOutreachLeadEntity,
} from '../entities';
import { BrokerOutreachService } from './broker-outreach.service';
import { CampaignAiDrafterService } from './campaign-ai-drafter.service';

/**
 * Campaign engine: orchestrates the campaign → leads → invite → email
 * flow. Sits on top of BrokerOutreachService (which it already drives)
 * + adds two campaign-level features:
 *
 *   1. Draft versioning: every "saved" subject/body becomes a versioned
 *      entry under metadata.drafts; one is marked selected. Lets
 *      operators preview AI-assisted drafts before committing.
 *
 *   2. Send-to-segment: given a set of lead IDs (or a filter), create
 *      an invite for each lead linked to the campaign — uses the
 *      existing createInvite path (which already routes through the
 *      email service). Returns a per-lead report.
 *
 * AI drafting itself is a pluggable interface — the default is the
 * deterministic templated draft already produced by
 * BrokerOutreachService.draftEmail; a real AI provider can implement
 * `CampaignAiDrafter` later without touching this orchestrator.
 */
export interface CampaignDraftVariant {
  id: string;
  label: string;
  subject: string;
  body: string;
  authoredBy: string;
  authoredAt: string;
  promptHint?: string | null;
  promotedAt?: string | null;
}

export interface SaveCampaignDraftInput {
  campaignId: string;
  label?: string;
  subject: string;
  body: string;
  promptHint?: string | null;
}

export interface SendCampaignInput {
  campaignId: string;
  leadIds: string[];
  expiresInDays?: number;
}

export interface CampaignSendReport {
  campaignId: string;
  attempted: number;
  invitesCreated: number;
  emailsSent: number;
  suppressed: number;
  failed: number;
  results: Array<{
    leadId: string;
    status: 'invited' | 'suppressed' | 'failed' | 'skipped';
    inviteId?: string;
    error?: string;
  }>;
}

@Injectable()
export class BrokerOutreachCampaignEngineService {
  private readonly logger = new Logger(BrokerOutreachCampaignEngineService.name);

  constructor(
    @InjectRepository(BrokerOutreachCampaignEntity)
    private readonly campaigns: Repository<BrokerOutreachCampaignEntity>,
    @InjectRepository(BrokerOutreachLeadEntity)
    private readonly leads: Repository<BrokerOutreachLeadEntity>,
    private readonly outreach: BrokerOutreachService,
    @Optional() private readonly audit: AuditService | null = null,
    @Optional() private readonly aiDrafter: CampaignAiDrafterService | null = null,
  ) {}

  /**
   * Ask the AI drafter (when wired) for N variants for this campaign +
   * optional lead. Each variant is auto-saved as a draft so the
   * operator can compare, promote one, or discard. Returns the updated
   * draft list. Falls back to a deterministic single variant when the
   * drafter is unavailable.
   */
  async generateAiDrafts(
    input: {
      campaignId: string;
      leadId?: string;
      variants?: number;
      toneHint?: string | null;
    },
    actor = 'system',
  ): Promise<{
    drafts: CampaignDraftVariant[];
    selectedDraftId: string;
    source: 'ai' | 'fallback';
  }> {
    const campaign = await this.requireCampaign(input.campaignId);
    let lead: BrokerOutreachLeadEntity | null = null;
    if (input.leadId) {
      lead = await this.leads.findOne({ where: { id: input.leadId } });
    }
    const aiVariants = this.aiDrafter
      ? await this.aiDrafter.draft({
          campaign,
          lead,
          variants: input.variants,
          toneHint: input.toneHint ?? null,
        })
      : null;

    const fromAi = aiVariants ?? [];
    if (fromAi.length === 0) {
      // Deterministic fallback so the operator always gets at least one
      // working draft to review.
      const fallback = {
        label: 'fallback',
        subject:
          campaign.emailSubject ??
          `A faster broker workspace for ${lead?.companyName ?? 'your team'}`,
        body:
          campaign.emailBody ??
          `Hi ${lead?.companyName ?? 'your team'},\n\nDigiTrend is opening a broker workspace for your team. Reply to learn more.\n\n{{claimUrl}}`,
      };
      const saved = await this.saveDraft(
        {
          campaignId: campaign.id,
          subject: fallback.subject,
          body: fallback.body,
          label: fallback.label,
          promptHint: input.toneHint ?? null,
        },
        actor,
      );
      return { ...saved, source: 'fallback' };
    }

    let drafts: CampaignDraftVariant[] = readDrafts(campaign);
    let selectedDraftId = '';
    for (const variant of fromAi) {
      const result = await this.saveDraft(
        {
          campaignId: campaign.id,
          subject: variant.subject,
          body: variant.body,
          label: variant.label,
          promptHint: input.toneHint ?? null,
        },
        actor,
      );
      drafts = result.drafts;
      selectedDraftId = result.selectedDraftId;
    }
    return { drafts, selectedDraftId, source: 'ai' };
  }

  /**
   * Save a new draft variant for a campaign. The new variant becomes
   * the "selected" draft unless a previous variant was explicitly
   * promoted. Keeps the previous selected variant in `metadata.drafts`
   * so an operator can compare or revert.
   */
  async saveDraft(
    input: SaveCampaignDraftInput,
    actor = 'system',
  ): Promise<{
    campaign: BrokerOutreachCampaignEntity;
    drafts: CampaignDraftVariant[];
    selectedDraftId: string;
  }> {
    if (!input.subject?.trim() || !input.body?.trim()) {
      throw new BadRequestException('draft requires subject + body');
    }
    const campaign = await this.requireCampaign(input.campaignId);
    const existingDrafts = readDrafts(campaign);
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const variant: CampaignDraftVariant = {
      id,
      label: input.label?.trim() || `v${existingDrafts.length + 1}`,
      subject: input.subject.trim(),
      body: input.body.trim(),
      authoredBy: actor,
      authoredAt: new Date().toISOString(),
      promptHint: input.promptHint ?? null,
    };
    const drafts = [...existingDrafts, variant];
    const selectedDraftId = id;
    campaign.metadata = {
      ...(campaign.metadata ?? {}),
      drafts,
      selectedDraftId,
    } as Record<string, unknown>;
    campaign.emailSubject = variant.subject;
    campaign.emailBody = variant.body;
    campaign.updatedBy = actor;
    const saved = await this.campaigns.save(campaign);
    await this.auditRecord('broker_outreach.campaign_draft_saved', actor, saved.id, {
      draftId: id,
      label: variant.label,
    });
    return { campaign: saved, drafts, selectedDraftId };
  }

  /** Promote an existing draft variant to be the selected one. */
  async promoteDraft(
    campaignId: string,
    draftId: string,
    actor = 'system',
  ): Promise<BrokerOutreachCampaignEntity> {
    const campaign = await this.requireCampaign(campaignId);
    const drafts = readDrafts(campaign);
    const target = drafts.find((d) => d.id === draftId);
    if (!target) throw new NotFoundException(`draft ${draftId} not found`);
    target.promotedAt = new Date().toISOString();
    campaign.emailSubject = target.subject;
    campaign.emailBody = target.body;
    campaign.metadata = {
      ...(campaign.metadata ?? {}),
      drafts,
      selectedDraftId: draftId,
    } as Record<string, unknown>;
    campaign.updatedBy = actor;
    const saved = await this.campaigns.save(campaign);
    await this.auditRecord('broker_outreach.campaign_draft_promoted', actor, saved.id, {
      draftId,
    });
    return saved;
  }

  /** Read the draft variants for a campaign. */
  async listDrafts(campaignId: string): Promise<{
    drafts: CampaignDraftVariant[];
    selectedDraftId: string | null;
  }> {
    const campaign = await this.requireCampaign(campaignId);
    return {
      drafts: readDrafts(campaign),
      selectedDraftId:
        (campaign.metadata as any)?.selectedDraftId ?? null,
    };
  }

  /**
   * Send the campaign to a set of leads. For each lead we delegate to
   * BrokerOutreachService.createInvite which already handles draft
   * personalization, email transport, suppression checks, and audit.
   */
  async sendToLeads(
    input: SendCampaignInput,
    actor = 'system',
  ): Promise<CampaignSendReport> {
    const campaign = await this.requireCampaign(input.campaignId);
    const uniqueLeadIds = [...new Set(input.leadIds ?? [])].filter(Boolean);
    if (uniqueLeadIds.length === 0) {
      throw new BadRequestException('sendToLeads requires at least one leadId');
    }
    const report: CampaignSendReport = {
      campaignId: campaign.id,
      attempted: uniqueLeadIds.length,
      invitesCreated: 0,
      emailsSent: 0,
      suppressed: 0,
      failed: 0,
      results: [],
    };
    for (const leadId of uniqueLeadIds) {
      try {
        const lead = await this.leads.findOne({ where: { id: leadId } });
        if (!lead || !lead.contactEmail) {
          report.failed += 1;
          report.results.push({
            leadId,
            status: 'failed',
            error: lead ? 'lead has no contactEmail' : 'lead not found',
          });
          continue;
        }
        const created = await this.outreach.createInvite(
          {
            leadId,
            campaignId: campaign.id,
            expiresInDays: input.expiresInDays,
          },
          actor,
        );
        report.invitesCreated += 1;
        const sendStatus = created.send?.status ?? null;
        if (sendStatus === 'sent') report.emailsSent += 1;
        else if (sendStatus === 'suppressed') report.suppressed += 1;
        report.results.push({
          leadId,
          status: sendStatus === 'suppressed' ? 'suppressed' : 'invited',
          inviteId: created.invite.id,
        });
      } catch (e: any) {
        this.logger.warn(
          `campaign.send.failed campaign=${campaign.id} lead=${leadId}: ${e?.message ?? e}`,
        );
        report.failed += 1;
        report.results.push({
          leadId,
          status: 'failed',
          error: e?.message ?? String(e),
        });
      }
    }
    // Update campaign metrics + status.
    const prevMetrics = (campaign.metrics ?? {}) as Record<string, any>;
    campaign.metrics = {
      ...prevMetrics,
      leadsImported: prevMetrics.leadsImported ?? 0,
      invitesCreated:
        (prevMetrics.invitesCreated ?? 0) + report.invitesCreated,
      claims: prevMetrics.claims ?? 0,
      lastSendAt: new Date().toISOString(),
    };
    if (campaign.status === 'draft' && report.invitesCreated > 0) {
      campaign.status = 'active';
    }
    campaign.updatedBy = actor;
    await this.campaigns.save(campaign);
    await this.auditRecord('broker_outreach.campaign_sent', actor, campaign.id, {
      attempted: report.attempted,
      invitesCreated: report.invitesCreated,
      emailsSent: report.emailsSent,
      suppressed: report.suppressed,
      failed: report.failed,
    });
    return report;
  }

  private async requireCampaign(
    id: string,
  ): Promise<BrokerOutreachCampaignEntity> {
    const campaign = await this.campaigns.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException(`campaign ${id} not found`);
    return campaign;
  }

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
      resourceType: 'broker_outreach_campaign',
      resourceId,
      source: 'broker-outreach',
      metadata,
    });
  }
}

function readDrafts(
  campaign: BrokerOutreachCampaignEntity,
): CampaignDraftVariant[] {
  const md = (campaign.metadata as any) ?? {};
  const drafts = Array.isArray(md.drafts) ? md.drafts : [];
  return drafts as CampaignDraftVariant[];
}
