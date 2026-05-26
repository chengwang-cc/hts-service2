import { Injectable, Logger, Optional } from '@nestjs/common';
import { OpenAiService } from '@hts/core';
import {
  BrokerOutreachCampaignEntity,
  BrokerOutreachLeadEntity,
} from '../entities';

/**
 * AI drafter for outreach emails.
 *
 * Plugged in behind the deterministic template seam — when a real OpenAI
 * key is configured AND `BROKER_OUTREACH_AI_DRAFTING_ENABLED=true`, the
 * campaign engine can call this to produce N variants for a campaign /
 * lead pair. Otherwise the deterministic template path remains the
 * fallback, which keeps tests + dev environments working without an
 * API key.
 *
 * Output is JSON-mode (object with `variants` array) so we never get
 * partial-string drift between attempts.
 */
export interface AiDraftRequest {
  campaign: BrokerOutreachCampaignEntity;
  lead?: BrokerOutreachLeadEntity | null;
  /** Number of variants to generate (1-5). */
  variants?: number;
  /** Optional prompt nudge ("more direct", "shorter") added by the operator. */
  toneHint?: string | null;
}

export interface AiDraftVariant {
  label: string;
  subject: string;
  body: string;
}

@Injectable()
export class CampaignAiDrafterService {
  private readonly logger = new Logger(CampaignAiDrafterService.name);

  constructor(
    @Optional() private readonly openai: OpenAiService | null = null,
  ) {}

  /**
   * Returns null when AI drafting is disabled or no provider is bound;
   * callers should fall back to the deterministic template in that case.
   */
  async draft(input: AiDraftRequest): Promise<AiDraftVariant[] | null> {
    const enabled = process.env.BROKER_OUTREACH_AI_DRAFTING_ENABLED === 'true';
    if (!enabled || !this.openai) {
      return null;
    }
    const requestedCount = Math.max(1, Math.min(5, input.variants ?? 3));
    const lead = input.lead;
    const messages = [
      {
        role: 'system' as const,
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user' as const,
        content: this.buildUserPrompt({
          campaign: input.campaign,
          lead: lead ?? null,
          variants: requestedCount,
          toneHint: input.toneHint ?? null,
        }),
      },
    ];

    try {
      const completion = await this.openai.chat(messages, {
        model: process.env.BROKER_OUTREACH_AI_MODEL || 'gpt-5-nano',
        temperature: 0.4,
        response_format: { type: 'json_object' },
      });
      const text = completion?.choices?.[0]?.message?.content ?? '';
      const parsed = safeParse(text);
      const variants = parsed?.variants;
      if (!Array.isArray(variants) || variants.length === 0) {
        this.logger.warn(`ai drafter produced no variants; response="${text.slice(0, 200)}"`);
        return null;
      }
      return variants
        .map(coerceVariant)
        .filter((v): v is AiDraftVariant => v !== null)
        .slice(0, requestedCount);
    } catch (e: any) {
      this.logger.warn(`ai drafter failed: ${e?.message ?? e}`);
      return null;
    }
  }

  private buildUserPrompt(input: {
    campaign: BrokerOutreachCampaignEntity;
    lead: BrokerOutreachLeadEntity | null;
    variants: number;
    toneHint: string | null;
  }): string {
    const lines = [
      `You are drafting outreach emails for the marketing campaign "${input.campaign.name}".`,
      input.campaign.objective ? `Objective: ${input.campaign.objective}` : null,
      input.campaign.audience ? `Audience: ${input.campaign.audience}` : null,
      input.campaign.aiPrompt
        ? `Author tone guide: ${input.campaign.aiPrompt}`
        : null,
      input.toneHint ? `Additional tone nudge: ${input.toneHint}` : null,
      input.lead
        ? `Target lead context: company="${input.lead.companyName}" country=${input.lead.country ?? 'unknown'} businessCategory=${input.lead.businessCategory ?? 'unknown'}`
        : null,
      '',
      `Return JSON: { "variants": [{ "label": string, "subject": string, "body": string }, ...] }.`,
      `Produce exactly ${input.variants} variants. Each subject must be under 100 characters. Bodies should be 80-220 words and end with the literal placeholder "{{claimUrl}}".`,
      'Do not include external URLs, prices, legal claims, or guarantees about regulatory outcomes.',
    ];
    return lines.filter(Boolean).join('\n');
  }
}

const SYSTEM_PROMPT =
  'You are a careful B2B outreach copywriter for customs brokers, freight forwarders, exporters and importers. You write concise, professional, accurate emails. You never invent regulatory facts. Respond with strict JSON only.';

function safeParse(text: string): { variants?: unknown } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function coerceVariant(input: unknown): AiDraftVariant | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  if (typeof v.subject !== 'string' || typeof v.body !== 'string') return null;
  return {
    label: typeof v.label === 'string' && v.label.trim() ? v.label.trim() : 'ai',
    subject: v.subject.trim().slice(0, 255),
    body: v.body.trim().slice(0, 10000),
  };
}
