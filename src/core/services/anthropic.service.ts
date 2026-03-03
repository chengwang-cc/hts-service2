import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicCompleteOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  /** If true, send the system prompt with cache_control for prompt caching */
  cacheSystem?: boolean;
}

/**
 * Thin wrapper around the Anthropic SDK.
 * Supports structured JSON output via a json_schema instruction in the system prompt.
 */
@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic;

  // Pricing per 1M tokens (as of 2026)
  private readonly pricing: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
    'claude-haiku-4-5-20251001':  { input: 0.80, output: 4.0,  cacheWrite: 1.0,  cacheRead: 0.08 },
    'claude-sonnet-4-6':          { input: 3.00, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
    'claude-opus-4-6':            { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
  };

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({
      apiKey: config.get<string>('ANTHROPIC_API_KEY') ?? process.env.ANTHROPIC_API_KEY,
      // Short timeout for real-time search context; no retries to prevent cascading delay
      timeout: 30_000,
      maxRetries: 0,
    });
  }

  /**
   * Single-turn completion.  Returns the text of the first content block.
   */
  async complete(
    userMessage: string,
    options: AnthropicCompleteOptions = {},
  ): Promise<string> {
    const model = options.model ?? 'claude-haiku-4-5-20251001';
    const maxTokens = options.maxTokens ?? 1024;

    const systemParam: Anthropic.MessageParam['content'] | undefined = options.system
      ? options.cacheSystem
        ? ([
            {
              type: 'text',
              text: options.system,
              cache_control: { type: 'ephemeral' },
            },
          ] as unknown as string)
        : options.system
      : undefined;

    const t0 = Date.now();
    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(systemParam ? { system: systemParam as unknown as string } : {}),
      messages: [{ role: 'user', content: userMessage }],
    });

    const elapsed = Date.now() - t0;
    const usage = response.usage;
    this.logUsage(model, usage, elapsed);

    const block = response.content[0];
    if (block?.type !== 'text') {
      throw new Error(`Unexpected Anthropic response block type: ${block?.type}`);
    }
    return block.text;
  }

  /**
   * Convenience: complete and parse the response as JSON.
   * Throws if the response is not valid JSON.
   */
  async completeJson<T = unknown>(
    userMessage: string,
    options: AnthropicCompleteOptions = {},
  ): Promise<T> {
    const raw = await this.complete(userMessage, options);
    // Strip markdown code fences if present
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    return JSON.parse(stripped) as T;
  }

  private logUsage(
    model: string,
    usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null },
    elapsedMs: number,
  ): void {
    const p = this.pricing[model] ?? { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 };
    const cost =
      (usage.input_tokens / 1e6) * p.input +
      (usage.output_tokens / 1e6) * p.output +
      ((usage.cache_creation_input_tokens ?? 0) / 1e6) * p.cacheWrite +
      ((usage.cache_read_input_tokens ?? 0) / 1e6) * p.cacheRead;

    this.logger.debug(
      `Anthropic ${model}: in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `cache_write=${usage.cache_creation_input_tokens ?? 0} cache_read=${usage.cache_read_input_tokens ?? 0} ` +
      `cost=$${cost.toFixed(6)} elapsed=${elapsedMs}ms`,
    );
  }
}
