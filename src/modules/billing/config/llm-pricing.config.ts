/**
 * LLM model price book — USD per **million** tokens, split by token type.
 *
 * Source of truth: provider pricing pages, snapshot date 2026-06.
 *   - OpenAI:    https://openai.com/pricing
 *   - Anthropic: https://www.anthropic.com/pricing
 *
 * Token types we model:
 *   - 'input'         — billed prompt / context tokens (the un-cached part)
 *   - 'cached_input'  — discounted prompt-cache hits; absent → fall back to 'input' rate
 *   - 'output'        — completion tokens; zero for embeddings
 *
 * Pricing strategy
 * ----------------
 *   - This file is the FAST path for cost calculation — read on every
 *     LLM call to compute `costUsd` before the usage row is written.
 *   - The numbers are intentionally small and easy to audit. When a
 *     price changes we land a new commit, NOT a database update —
 *     historical rows keep the cost we charged at the time, which is
 *     what billing actually wants.
 *   - A future Phase 2 can move this to a `llm_pricing` table with
 *     `effective_from`/`effective_to`, but a static table is sufficient
 *     for the first cut and avoids one round-trip per call.
 *
 * Unknown model fallback
 * ----------------------
 *   When a model isn't in the book (new provider rollout, typo, etc.)
 *   `getLlmPriceUsdPerMillion` returns 0 — cost rolls up as zero for
 *   that call, rather than throwing. The log warning surfaces the
 *   missing entry without breaking the request path.
 */

import { Logger } from '@nestjs/common';

export type LlmTokenType = 'input' | 'cached_input' | 'output' | 'embedding';

/**
 * Per-model, per-token-type USD rate, expressed in dollars per 1M tokens.
 *
 * Conventions:
 *   - Embedding models populate 'embedding' AND alias 'input' to the
 *     same value (so callers that treat embeddings as "input-only" work
 *     unchanged).
 *   - Models we don't have a published cached-input rate for omit the
 *     'cached_input' key; the calculator falls back to the 'input' rate.
 */
export const LLM_PRICE_BOOK: Record<string, Partial<Record<LlmTokenType, number>>> = {
  // OpenAI — chat / response models (USD per 1M tokens, 2026-06)
  'gpt-5.4-nano': {
    input: 0.05,
    cached_input: 0.025,
    output: 0.2,
  },
  'gpt-5.4-mini': {
    input: 0.25,
    cached_input: 0.125,
    output: 1.0,
  },
  'gpt-5.4': {
    input: 1.25,
    cached_input: 0.625,
    output: 5.0,
  },

  // OpenAI — embedding models. `input` and `embedding` aliased.
  'text-embedding-3-small': {
    input: 0.02,
    embedding: 0.02,
    output: 0,
  },
  'text-embedding-3-large': {
    input: 0.13,
    embedding: 0.13,
    output: 0,
  },

  // Anthropic — Claude family. Anthropic exposes cache_read separately;
  // map their 'cache_read_input_tokens' to 'cached_input'.
  'claude-haiku-4-5': {
    input: 0.25,
    cached_input: 0.03,
    output: 1.25,
  },
  'claude-sonnet-4-6': {
    input: 3.0,
    cached_input: 0.3,
    output: 15.0,
  },
  'claude-opus-4-8': {
    input: 15.0,
    cached_input: 1.5,
    output: 75.0,
  },
};

const logger = new Logger('LlmPricingConfig');
const warnedModels = new Set<string>();

/**
 * USD per million tokens for `(model, tokenType)`. Returns `undefined`
 * when the (model, tokenType) pair is intentionally absent so callers
 * can fall back to a related rate (the canonical use case: missing
 * `cached_input` → use `input`).
 *
 * For an entirely unknown model, returns 0 and logs a one-shot warning.
 * Cost for the row will be zero — visible in the dashboard as an
 * outlier — but the request itself isn't penalised.
 */
export function getLlmPriceUsdPerMillion(
  model: string,
  tokenType: LlmTokenType,
): number {
  const entry = LLM_PRICE_BOOK[model];
  if (!entry) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      logger.warn(
        `Unknown LLM model "${model}" — cost will roll up as 0. ` +
          `Add it to LLM_PRICE_BOOK in llm-pricing.config.ts.`,
      );
    }
    return 0;
  }
  const rate = entry[tokenType];
  // Distinguish "intentionally absent" (undefined) from "free" (0).
  // Absent → caller picks a fallback; explicit 0 → free, don't fall back.
  if (rate === undefined) return undefined as unknown as number;
  return rate;
}

/**
 * Normalised model identifier — strips OpenAI/Anthropic snapshot suffixes
 * so dashboard groupings stay sane across point releases. For example,
 * `gpt-5.4-mini-2026-04-01` rolls up under `gpt-5.4-mini`.
 *
 * Right-trims a trailing date suffix (-YYYY-MM-DD) and the few known
 * vendor suffixes. Conservative on purpose — when we can't recognise
 * the shape, we keep the model name verbatim.
 */
export function normaliseModelName(model: string): string {
  // Strip trailing -YYYY-MM-DD snapshot tag (OpenAI convention)
  const dateStripped = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  // Strip trailing -latest (Anthropic convention)
  const latestStripped = dateStripped.replace(/-latest$/, '');
  return latestStripped;
}
