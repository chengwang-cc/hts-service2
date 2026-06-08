import { AsyncLocalStorage } from 'node:async_hooks';
import {
  getLlmPriceUsdPerMillion,
  normaliseModelName,
  type LlmTokenType,
} from '../../modules/billing/config/llm-pricing.config';

/**
 * LLM usage tracking, threaded across the async call tree via
 * AsyncLocalStorage.
 *
 * Why AsyncLocalStorage instead of plumbing usage through every service
 * signature?
 *   1. A single request can fan out into many LLM calls — embedding +
 *      rerank + chat + vision. Threading `{ inputTokens, outputTokens,
 *      model }` through every return type means touching ~20 services
 *      for a feature that nobody outside the metering layer cares about.
 *   2. The pg-boss async path has no req object at all. AsyncLocalStorage
 *      is the same primitive whether we're inside an HTTP handler or
 *      inside a worker's job callback.
 *   3. OpenAiService can stay a leaf service. It pushes a usage record
 *      after each call; whoever opened the surrounding `withTracking()`
 *      reads the aggregate. No coupling either way.
 *
 * Usage at the entry point (HTTP interceptor, pg-boss handler, batch worker):
 *
 *     const usage = await llmUsageTracker.withTracking(async () => {
 *       return doSomethingThatCallsOpenAi();
 *     });
 *     // usage = { inputTokens, outputTokens, cachedTokens, costUsd,
 *     //           primaryModel, callsByModel: { 'gpt-5.4-mini': {...} } }
 *
 * Usage inside leaf services that issue model calls (OpenAiService,
 * AnthropicService):
 *
 *     llmUsageTracker.record({
 *       model: 'gpt-5.4-mini',
 *       inputTokens: usage.prompt_tokens ?? 0,
 *       outputTokens: usage.completion_tokens ?? 0,
 *       cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
 *     });
 *
 * When called outside an active `withTracking` scope, `record()` is a
 * no-op — scripts, smoke tests, and warm-up calls don't have to set up
 * a context.
 */

export interface LlmCallRecord {
  /** Model name as returned by the provider, e.g. `gpt-5.4-mini`. */
  model: string;
  /** Tokens consumed by the prompt / input. */
  inputTokens: number;
  /** Tokens generated as completion / output. Zero for embeddings. */
  outputTokens: number;
  /**
   * Cached input tokens (OpenAI `prompt_tokens_details.cached_tokens`,
   * Anthropic `cache_read_input_tokens`). Subset of inputTokens.
   * Optional — providers that don't expose this leave it at 0.
   */
  cachedTokens?: number;
  /**
   * Token classification — `chat`, `completion`, `embedding`, `vision`.
   * Used to pick the right rate from the price book (vision tokens are
   * billed differently from chat tokens on some models).
   */
  tokenType?: LlmTokenType;
  /**
   * Optional pipeline stage tag for slicing dashboards. Examples:
   * 'smart-classify.rerank', 'detection.bulk', 'agent.tool-loop'.
   */
  stage?: string;
}

export interface LlmModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  calls: number;
}

export interface LlmAggregatedUsage {
  /** Sum of input tokens across all calls in the scope. */
  inputTokens: number;
  /** Sum of output tokens across all calls in the scope. */
  outputTokens: number;
  /** Sum of cached input tokens across all calls in the scope. */
  cachedTokens: number;
  /** Computed dollar cost across all calls in the scope. */
  costUsd: number;
  /** Total number of model calls in the scope. */
  totalCalls: number;
  /**
   * The model contributing the most cost. Used by the metrics row's
   * single `model_name` column. Null when no calls were recorded.
   */
  primaryModel: string | null;
  /** Per-model breakdown — useful for the per-model dashboard tile. */
  callsByModel: Record<string, LlmModelUsage>;
  /**
   * The first non-empty `stage` value recorded. Used to tag the metrics
   * row with the pipeline stage that issued the call. Null when nothing
   * was tagged.
   */
  primaryStage: string | null;
}

interface MutableScope {
  callsByModel: Map<string, LlmModelUsage>;
  totalCalls: number;
  firstStage: string | null;
}

const storage = new AsyncLocalStorage<MutableScope>();

function emptyScope(): MutableScope {
  return { callsByModel: new Map(), totalCalls: 0, firstStage: null };
}

function emptyModelUsage(): LlmModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
    calls: 0,
  };
}

function costForCall(call: LlmCallRecord): number {
  // OpenAI / Anthropic responses carry the snapshot model name —
  // `gpt-5.4-nano-2026-03-17`, not the canonical `gpt-5.4-nano`. Look
  // up the price under the canonical name so we don't roll up every
  // snapshot release as an unknown model with $0 cost.
  const canonical = normaliseModelName(call.model);
  const inputPrice = getLlmPriceUsdPerMillion(canonical, 'input');
  const outputPrice = getLlmPriceUsdPerMillion(canonical, 'output');
  // Cached input tokens (when reported) are billed at a discounted rate
  // by both major providers. The pricing config exposes a 'cached_input'
  // entry per model; if absent, fall back to the regular input rate.
  const cachedPrice =
    getLlmPriceUsdPerMillion(canonical, 'cached_input') ?? inputPrice;

  const billedInputTokens = Math.max(
    0,
    (call.inputTokens ?? 0) - (call.cachedTokens ?? 0),
  );
  const cachedTokens = call.cachedTokens ?? 0;
  const outputTokens = call.outputTokens ?? 0;

  return (
    (billedInputTokens * inputPrice) / 1_000_000 +
    (cachedTokens * cachedPrice) / 1_000_000 +
    (outputTokens * outputPrice) / 1_000_000
  );
}

function pickPrimaryModel(scope: MutableScope): string | null {
  let bestModel: string | null = null;
  let bestCost = -1;
  for (const [model, m] of scope.callsByModel) {
    if (m.costUsd > bestCost) {
      bestCost = m.costUsd;
      bestModel = model;
    }
  }
  return bestModel;
}

function aggregate(scope: MutableScope): LlmAggregatedUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let costUsd = 0;
  const callsByModel: Record<string, LlmModelUsage> = {};
  for (const [model, m] of scope.callsByModel) {
    inputTokens += m.inputTokens;
    outputTokens += m.outputTokens;
    cachedTokens += m.cachedTokens;
    costUsd += m.costUsd;
    callsByModel[model] = { ...m };
  }
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    costUsd,
    totalCalls: scope.totalCalls,
    primaryModel: pickPrimaryModel(scope),
    callsByModel,
    primaryStage: scope.firstStage,
  };
}

/**
 * Run `work` inside a fresh usage-tracking scope. `record()` calls made
 * synchronously OR asynchronously from inside `work` accumulate into
 * the scope's totals. Returns `{ result, usage }`.
 *
 * Nested `withTracking` calls each get their own scope; recordings only
 * land in the innermost active scope. (This is intentional — a worker
 * job inside an HTTP handler should bill against the job's lifetime,
 * not the outer request.)
 */
async function withTracking<T>(
  work: () => Promise<T>,
): Promise<{ result: T; usage: LlmAggregatedUsage }> {
  const scope = emptyScope();
  const result = await storage.run(scope, work);
  return { result, usage: aggregate(scope) };
}

/**
 * Record one LLM call against the currently-active scope. No-op when no
 * scope is active (so scripts, warm-up calls, and tests don't have to
 * set anything up).
 */
function record(call: LlmCallRecord): void {
  const scope = storage.getStore();
  if (!scope) return;

  const cachedTokens = call.cachedTokens ?? 0;
  const cost = costForCall(call);

  // Key the per-model rollup by the canonical name. Without this, the
  // April and May snapshots of the same model would split into
  // separate buckets, and the primary-model picker would tie-break
  // arbitrarily on the first one inserted instead of summing them.
  const canonical = normaliseModelName(call.model);

  const existing = scope.callsByModel.get(canonical) ?? emptyModelUsage();
  existing.inputTokens += call.inputTokens;
  existing.outputTokens += call.outputTokens;
  existing.cachedTokens += cachedTokens;
  existing.costUsd += cost;
  existing.calls += 1;
  scope.callsByModel.set(canonical, existing);
  scope.totalCalls += 1;

  if (!scope.firstStage && call.stage) {
    scope.firstStage = call.stage;
  }
}

/**
 * Snapshot the active scope's aggregate without ending the scope.
 * Useful inside long-running handlers that want to emit interim
 * progress events; production code should prefer the return value of
 * `withTracking`.
 */
function snapshot(): LlmAggregatedUsage | null {
  const scope = storage.getStore();
  if (!scope) return null;
  return aggregate(scope);
}

/**
 * True when called from inside an active `withTracking` scope. Mostly
 * a test helper.
 */
function hasActiveScope(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * Imperative scope control for callers (NestJS interceptors, observable
 * pipelines) that can't model the work as `() => Promise`. Returns the
 * scope handle plus the result of running `fn` synchronously inside it.
 * The caller MUST call `closeScope(handle)` exactly once when work
 * completes, then read the aggregate from `handle.aggregate()`.
 *
 * Use case: NestJS `intercept(ctx, next)` returns an Observable, not a
 * Promise. We need the scope to span the Observable's subscribe →
 * complete window so that any `record()` made from the handler's async
 * tree lands in the scope. `withTracking` (which awaits a Promise)
 * doesn't fit that shape — this helper does.
 */
interface ScopeHandle {
  /** Snapshot the scope's totals as it stands now. */
  aggregate(): LlmAggregatedUsage;
}

function openScope<T>(fn: () => T): { handle: ScopeHandle; result: T } {
  const scope = emptyScope();
  const result = storage.run(scope, fn);
  return {
    result,
    handle: { aggregate: () => aggregate(scope) },
  };
}

export const llmUsageTracker = {
  withTracking,
  openScope,
  record,
  snapshot,
  hasActiveScope,
};
