import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { KnowledgeQueryCitation } from '../../knowledgebase-cards/services/knowledge-query.service';
import type { QueryBuilderInputDto } from '../dto/query-builder.dto';

/**
 * QueryBuilderSynthesizerService.
 *
 * Calls OpenAI to assemble a cited, grounded answer from the planner's
 * retrieved knowledge cards. The synthesizer is opt-in via
 * `OPENAI_API_KEY` (and optionally `QUERY_BUILDER_SYNTH_MODEL`).
 * When unavailable, `synthesize` returns `null` so QueryBuilderService
 * falls back to the deterministic stitch — this keeps the unit test
 * contract intact (no network in CI) and lets dev environments without
 * a key continue to render real content.
 *
 * Grounding discipline:
 *   - Citations are passed in-context only; the model is instructed
 *     to refuse to invent claims and to inline `[cardKey]` references
 *     for every assertion.
 *   - Excerpts are truncated to ~600 chars each, and at most 8 cards
 *     are sent, to keep prompt + completion well under the budget for
 *     the default `gpt-5.4-mini` model.
 */
@Injectable()
export class QueryBuilderSynthesizerService {
  private readonly logger = new Logger(QueryBuilderSynthesizerService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    } else {
      this.client = null;
    }
    this.model = process.env.QUERY_BUILDER_SYNTH_MODEL?.trim() || 'gpt-5.4-mini';
    this.timeoutMs = Number(process.env.QUERY_BUILDER_SYNTH_TIMEOUT_MS || 12_000);
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async synthesize(
    input: QueryBuilderInputDto,
    citations: KnowledgeQueryCitation[],
  ): Promise<string | null> {
    if (!this.client) return null;
    if (citations.length === 0) return null;

    const trimmed = citations.slice(0, 8).map((c) => ({
      cardKey: c.cardKey,
      jurisdiction: c.jurisdiction ?? 'unknown',
      documentType: c.documentType,
      effectiveDate: c.effectiveDate
        ? new Date(c.effectiveDate).toISOString().slice(0, 10)
        : null,
      excerpt: c.excerpt.length > 600 ? `${c.excerpt.slice(0, 600)}…` : c.excerpt,
    }));

    const systemPrompt = [
      'You are a trade-compliance assistant synthesizing an answer for a customs broker.',
      'You may only use facts present in the provided citations.',
      'For every assertion, cite the supporting card as `[cardKey]` inline.',
      'If the citations do not cover an aspect of the question, say so explicitly — never invent.',
      'Keep the answer under 250 words. Plain prose, no markdown headings, no preamble.',
    ].join(' ');

    const userPrompt = [
      `Question: ${input.question.trim()}`,
      input.role ? `Asker role: ${input.role}` : null,
      input.hts ? `HTS: ${input.hts}` : null,
      input.originCountry ? `Origin: ${input.originCountry}` : null,
      input.destinationCountry ? `Destination: ${input.destinationCountry}` : null,
      input.ruleArea ? `Rule area: ${input.ruleArea}` : null,
      input.effectiveAt ? `Effective at: ${input.effectiveAt}` : null,
      '',
      'Citations (JSON):',
      JSON.stringify(trimmed, null, 2),
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_completion_tokens: 600,
        },
        { timeout: this.timeoutMs },
      );
      const text = response.choices?.[0]?.message?.content?.trim();
      return text && text.length > 0 ? text : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`query-builder synthesis failed: ${msg}`);
      return null;
    }
  }
}
