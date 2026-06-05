import { llmUsageTracker } from './llm-usage-tracker';

describe('LlmUsageTracker', () => {
  it('returns null aggregate when called outside a scope', () => {
    expect(llmUsageTracker.snapshot()).toBeNull();
    expect(llmUsageTracker.hasActiveScope()).toBe(false);
  });

  it('record() is a no-op outside an active scope', () => {
    // Doesn't throw, doesn't accumulate anywhere.
    expect(() =>
      llmUsageTracker.record({
        model: 'gpt-5.4-mini',
        inputTokens: 100,
        outputTokens: 50,
      }),
    ).not.toThrow();
  });

  it('aggregates a single call with input + output cost', async () => {
    const { usage } = await llmUsageTracker.withTracking(async () => {
      llmUsageTracker.record({
        model: 'gpt-5.4-mini',
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      });
      return 42;
    });

    expect(usage.totalCalls).toBe(1);
    expect(usage.inputTokens).toBe(1_000_000);
    expect(usage.outputTokens).toBe(500_000);
    expect(usage.cachedTokens).toBe(0);
    expect(usage.primaryModel).toBe('gpt-5.4-mini');
    // gpt-5.4-mini: input=$0.25/M, output=$1.00/M
    // 1M input * 0.25 + 0.5M output * 1.0 = 0.25 + 0.5 = $0.75
    expect(usage.costUsd).toBeCloseTo(0.75, 6);
  });

  it('discounts cached input tokens at the cached_input rate', async () => {
    const { usage } = await llmUsageTracker.withTracking(async () => {
      llmUsageTracker.record({
        model: 'gpt-5.4-mini',
        inputTokens: 2_000_000,
        cachedTokens: 1_000_000,
        outputTokens: 0,
      });
      return null;
    });

    // billed input = 2M - 1M = 1M @ $0.25/M  → $0.25
    // cached     = 1M             @ $0.125/M → $0.125
    // output     = 0
    expect(usage.costUsd).toBeCloseTo(0.375, 6);
    expect(usage.cachedTokens).toBe(1_000_000);
  });

  it('aggregates across multiple calls + multiple models', async () => {
    const { usage } = await llmUsageTracker.withTracking(async () => {
      llmUsageTracker.record({
        model: 'gpt-5.4-nano',
        inputTokens: 1_000_000,
        outputTokens: 100_000,
      });
      llmUsageTracker.record({
        model: 'gpt-5.4-mini',
        inputTokens: 500_000,
        outputTokens: 200_000,
      });
      llmUsageTracker.record({
        model: 'gpt-5.4-nano',
        inputTokens: 1_000_000,
        outputTokens: 0,
      });
      return null;
    });

    expect(usage.totalCalls).toBe(3);
    expect(usage.inputTokens).toBe(2_500_000);
    expect(usage.outputTokens).toBe(300_000);
    expect(usage.callsByModel['gpt-5.4-nano'].calls).toBe(2);
    expect(usage.callsByModel['gpt-5.4-mini'].calls).toBe(1);
    // gpt-5.4-mini is more expensive — should be the primary model.
    expect(usage.primaryModel).toBe('gpt-5.4-mini');
  });

  it('isolates concurrent scopes via AsyncLocalStorage', async () => {
    const work = async (model: string, tokens: number) => {
      const { usage } = await llmUsageTracker.withTracking(async () => {
        // Insert an await to yield the event loop, so concurrent
        // scopes interleave.
        await new Promise((r) => setImmediate(r));
        llmUsageTracker.record({
          model,
          inputTokens: tokens,
          outputTokens: 0,
        });
        return null;
      });
      return usage;
    };

    const [a, b, c] = await Promise.all([
      work('gpt-5.4-mini', 1_000_000),
      work('gpt-5.4-nano', 500_000),
      work('gpt-5.4-mini', 2_000_000),
    ]);

    expect(a.inputTokens).toBe(1_000_000);
    expect(b.inputTokens).toBe(500_000);
    expect(c.inputTokens).toBe(2_000_000);
  });

  it('records the first non-empty pipeline stage', async () => {
    const { usage } = await llmUsageTracker.withTracking(async () => {
      llmUsageTracker.record({
        model: 'gpt-5.4-mini',
        inputTokens: 100,
        outputTokens: 50,
        stage: 'smart-classify.rerank',
      });
      llmUsageTracker.record({
        model: 'gpt-5.4-mini',
        inputTokens: 100,
        outputTokens: 50,
        stage: 'smart-classify.followup',
      });
      return null;
    });
    expect(usage.primaryStage).toBe('smart-classify.rerank');
  });

  it('unknown model logs a warning but rolls up cost as zero', async () => {
    const { usage } = await llmUsageTracker.withTracking(async () => {
      llmUsageTracker.record({
        model: 'gpt-99-mythical',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      return null;
    });
    expect(usage.totalCalls).toBe(1);
    expect(usage.inputTokens).toBe(1_000_000);
    expect(usage.costUsd).toBe(0);
  });
});
