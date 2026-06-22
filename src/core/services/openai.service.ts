import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { Agent, fetch as undiciFetch } from 'undici';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type {
  Response,
  ResponseCreateParamsStreaming,
  ResponseFormatTextConfig,
  ResponseCreateParamsNonStreaming,
  ResponseInput,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import { llmUsageTracker } from './llm-usage-tracker';

type ChatOptions = Partial<
  Omit<ChatCompletionCreateParamsNonStreaming, 'messages' | 'stream'>
> & {
  model?: string;
};

type LegacyJSONSchemaFormat = {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
    description?: string;
  };
};

type ResponseOptions = Partial<
  Omit<ResponseCreateParamsNonStreaming, 'input' | 'stream' | 'text'>
> & {
  model?: string;
  text?: {
    format?: ResponseFormatTextConfig | LegacyJSONSchemaFormat;
  };
};

/**
 * OpenAI Service Implementation
 * Handles all interactions with OpenAI API (GPT-4, embeddings)
 * Includes rate limiting, retry logic, and cost tracking
 */
@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly client: OpenAI;
  private readonly dispatcher: Agent;
  private readonly maxConnRetries: number;
  private readonly useResponsesApi: boolean;
  private usageStats = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
  };

  // Pricing per 1M tokens (as of 2026)
  private readonly pricing = {
    'gpt-5.4-nano': { input: 0.05, output: 0.20 },
    'gpt-5.4-mini': { input: 0.25, output: 1.0 },
    'text-embedding-3-small': { input: 0.02, output: 0 },
    'text-embedding-3-large': { input: 0.13, output: 0 },
  };

  constructor(apiKey?: string) {
    if (!apiKey && !process.env.OPENAI_API_KEY) {
      throw new Error(
        'OpenAI API key is required. Set OPENAI_API_KEY environment variable.',
      );
    }

    // Custom undici dispatcher to mitigate "Premature close" — undici's
    // default keep-alive can reuse a pooled socket the server (OpenAI/
    // Cloudflare) has already closed, dropping the response body mid-stream.
    // Capping keepAliveMaxTimeout (default is 10 min) shrinks the stale-reuse
    // window; bodyTimeout/headersTimeout turn silent stalls into fast,
    // retryable errors. Overridable via env for ops tuning.
    const keepAliveMs = Number(process.env.OPENAI_KEEPALIVE_TIMEOUT_MS ?? 10_000);
    const bodyTimeoutMs = Number(process.env.OPENAI_BODY_TIMEOUT_MS ?? 60_000);
    this.dispatcher = new Agent({
      keepAliveTimeout: 4_000,
      keepAliveMaxTimeout: keepAliveMs,
      bodyTimeout: bodyTimeoutMs,
      headersTimeout: bodyTimeoutMs,
      connect: { timeout: 10_000 },
    });
    this.maxConnRetries = Number(process.env.OPENAI_CONN_MAX_RETRIES ?? 3);

    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
      // Route the SDK through our tuned dispatcher.
      fetch: ((url: any, init?: any) =>
        undiciFetch(url, { ...(init ?? {}), dispatcher: this.dispatcher })) as any,
      // SDK-level retries (covers connect-phase + 429/5xx). The app-level
      // withConnRetry() below additionally covers mid-body "Premature close",
      // which the SDK does NOT retry (it occurs after headers are received).
      maxRetries: Number(process.env.OPENAI_SDK_MAX_RETRIES ?? 2),
      timeout: Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? 60_000),
    });

    // Configuration: Use Responses API by default, but allow fallback via env var
    // Set OPENAI_USE_CHAT_COMPLETIONS=true to use legacy Chat Completions API
    this.useResponsesApi = process.env.OPENAI_USE_CHAT_COMPLETIONS !== 'true';

    this.logger.log(
      `OpenAI service initialized (api=${this.useResponsesApi ? 'Responses' : 'ChatCompletions'}, ` +
        `connRetries=${this.maxConnRetries}, keepAliveMax=${keepAliveMs}ms, bodyTimeout=${bodyTimeoutMs}ms)`,
    );
  }

  /**
   * Retry wrapper for transient connection-layer failures — notably undici
   * "Premature close" during response-body read, which the OpenAI SDK does
   * NOT retry. Retries are logged so failure/recovery rates are visible in
   * CloudWatch (`/ecs/hts-backend`). Non-connection errors (4xx, validation,
   * etc.) are rethrown immediately.
   */
  private async withConnRetry<T>(op: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxConnRetries; attempt++) {
      const started = Date.now();
      try {
        const result = await fn();
        if (attempt > 1) {
          this.logger.log(
            `[openai:${op}] recovered on attempt ${attempt}/${this.maxConnRetries} ` +
              `(${Date.now() - started}ms)`,
          );
        }
        return result;
      } catch (err) {
        lastErr = err;
        const retryable = OpenAiService.isRetryableConnError(err);
        // Final attempt / non-retryable: rethrow and let the caller log with
        // its own request context (input size, model, fallback taken).
        if (!retryable || attempt === this.maxConnRetries) throw err;
        const backoff = 250 * 2 ** (attempt - 1);
        this.logger.warn(
          `[openai:${op}] transient failure (attempt ${attempt}/${this.maxConnRetries}, ` +
            `${Date.now() - started}ms) ${OpenAiService.describeError(err)} — retrying in ${backoff}ms`,
        );
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }

  /** True for connection-layer / premature-close errors that are safe to retry. */
  private static isRetryableConnError(err: unknown): boolean {
    const e = err as { name?: string; code?: string; message?: string; cause?: { message?: string; code?: string } };
    const name = e?.name ?? '';
    if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true;
    const haystack = `${e?.message ?? ''} ${e?.code ?? ''} ${e?.cause?.message ?? ''} ${e?.cause?.code ?? ''}`.toLowerCase();
    return /premature close|other side closed|socket hang up|econnreset|epipe|etimedout|und_err|terminated|fetch failed|network|response body/.test(
      haystack,
    );
  }

  /** Compact, log-friendly description of an OpenAI/undici error. */
  private static describeError(err: unknown): string {
    const e = err as {
      name?: string; message?: string; status?: number; code?: string;
      request_id?: string; cause?: { message?: string; code?: string };
    };
    const parts = [
      e?.name && `name=${e.name}`,
      e?.status !== undefined && `status=${e.status}`,
      e?.code && `code=${e.code}`,
      e?.request_id && `reqId=${e.request_id}`,
      e?.cause?.code && `causeCode=${e.cause.code}`,
      e?.cause?.message && `cause="${e.cause.message}"`,
      e?.message && `msg="${e.message}"`,
    ].filter(Boolean);
    return parts.join(' ');
  }

  /**
   * Send response request (Responses API only)
   * This is OpenAI's standard API as of 2026
   */
  async response(
    input: string | ResponseInput,
    options: ResponseOptions = {},
  ): Promise<Response> {
    const {
      model = 'gpt-5.4-mini',
      instructions,
      temperature,
      max_output_tokens,
      top_p,
      previous_response_id,
      store,
      text,
    } = options;

    try {
      const startTime = Date.now();

      // Build request parameters according to official Responses API spec
      const requestParams: ResponseCreateParamsNonStreaming = {
        model,
        input,
        stream: false,
      };

      // Only add temperature if specified (some models don't support it)
      if (temperature !== undefined) {
        requestParams.temperature = temperature;
      }

      // Add optional instructions (replaces system message)
      if (instructions) requestParams.instructions = instructions;
      if (max_output_tokens)
        requestParams.max_output_tokens = max_output_tokens;
      if (top_p) requestParams.top_p = top_p;
      if (previous_response_id) {
        requestParams.previous_response_id = previous_response_id;
      }

      // Storage control (default is true in Responses API)
      if (store !== undefined) requestParams.store = store;

      // Structured output using text.format (not response_format)
      if (text?.format) {
        requestParams.text = {
          format: this.normalizeTextFormat(text.format),
        };
      }

      const response = await this.withConnRetry('responses', () =>
        this.client.responses.create(requestParams),
      );

      const duration = Date.now() - startTime;

      // Extract response data
      const usage = (response as any).usage;

      // Track usage. The Responses API uses `input_tokens` /
      // `output_tokens` (and `input_tokens_details.cached_tokens`) —
      // distinct from Chat Completions' `prompt_tokens` /
      // `completion_tokens`. Read both name pairs so the same code
      // works for either shape (the Chat-fallback path below routes
      // through `chat()` which has its own block); previously this
      // block only read the Chat Completions names and silently
      // discarded every Responses-API token count.
      if (usage) {
        const inputTokens =
          (usage as any).input_tokens ?? (usage as any).prompt_tokens ?? 0;
        const outputTokens =
          (usage as any).output_tokens ?? (usage as any).completion_tokens ?? 0;
        const cachedTokens =
          (usage as any).input_tokens_details?.cached_tokens ??
          (usage as any).prompt_tokens_details?.cached_tokens ??
          0;
        this.usageStats.totalPromptTokens += inputTokens;
        this.usageStats.totalCompletionTokens += outputTokens;
        this.usageStats.totalCost += this.calculateCost(
          model,
          inputTokens,
          outputTokens,
        );
        // Surface usage to any active LlmUsageTracker scope so the
        // request-level interceptor (or async-job wrapper) can roll it
        // up into req.attribution.extras / direct usage write. No-op
        // when called outside a scope (scripts, smoke tests, warm-ups).
        //
        // We pass the REQUESTED model name, not response.model. The SDK
        // sometimes returns snapshot-suffixed strings, dated variants,
        // or in rare cases an aliased family name — none of which the
        // operator asked for. The requested model is the contract; the
        // tracker normalises it anyway, but using the canonical input
        // makes the per-model dashboard column deterministic.
        llmUsageTracker.record({
          model,
          inputTokens,
          outputTokens,
          cachedTokens,
          tokenType: 'output',
        });
      }

      this.logger.log(
        `Response API: ${duration}ms, ${usage?.total_tokens || 0} tokens, model=${model}`,
      );

      return response;
    } catch (error) {
      this.logger.error(`Response API failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Fallback implementation using Chat Completions API
   * Used when Responses API is unavailable or disabled
   */
  private async responseWithChatFallback(
    input: string,
    options: ResponseOptions = {},
  ): Promise<Response> {
    const {
      model = 'gpt-5.4-mini',
      instructions,
      temperature = 0.7,
      max_output_tokens,
      top_p,
      text,
    } = options;

    const chatOptions: ChatOptions = {
      model,
      temperature,
      max_tokens: max_output_tokens,
      top_p,
    };

    // Convert text.format to Chat Completions response_format if present
    if (text?.format) {
      const normalized = this.normalizeTextFormat(text.format);
      const jsonSchema =
        normalized.type === 'json_schema'
          ? {
              name: normalized.name,
              schema: normalized.schema,
              ...(normalized.strict !== undefined
                ? { strict: normalized.strict }
                : {}),
            }
          : undefined;

      (chatOptions as any).response_format = {
        type: 'json_schema',
        ...(jsonSchema ? { json_schema: jsonSchema } : {}),
      };
    }

    // Build messages array with instructions as system message if provided
    const messages: ChatCompletionMessageParam[] = [];
    if (instructions) {
      messages.push({ role: 'system', content: instructions });
    }
    messages.push({ role: 'user', content: input });

    const chatResponse = await this.chat(messages, chatOptions);

    return {
      id: '',
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model: chatResponse.model || model,
      output: [],
      output_text: chatResponse.choices?.[0]?.message?.content || '',
      status: 'completed',
      error: null,
      incomplete_details: null,
      instructions: instructions || null,
      metadata: null,
      parallel_tool_calls: false,
      temperature: temperature ?? null,
      tool_choice: 'auto',
      tools: [],
      top_p: top_p ?? null,
      max_output_tokens: max_output_tokens ?? null,
      previous_response_id: null,
      reasoning: null,
      service_tier: null,
      store: false,
      text: { format: { type: 'text' } },
      truncation: 'disabled',
      usage: null,
      user: null,
    } as unknown as Response;
  }

  /**
   * Stream response (Responses API - recommended)
   */
  async *streamResponse(
    input: string | ResponseInput,
    options: ResponseOptions = {},
  ): AsyncIterable<ResponseStreamEvent> {
    const {
      model = 'gpt-5.4-mini',
      temperature = 0.7,
      max_output_tokens,
      top_p,
      previous_response_id,
      store = false,
    } = options;

    try {
      const requestParams: ResponseCreateParamsStreaming = {
        model,
        input,
        temperature,
        stream: true,
      };

      if (max_output_tokens)
        requestParams.max_output_tokens = max_output_tokens;
      if (top_p) requestParams.top_p = top_p;
      if (previous_response_id) {
        requestParams.previous_response_id = previous_response_id;
      }
      if (store) requestParams.store = store;

      const stream = await this.client.responses.create(requestParams);

      for await (const event of stream) {
        yield event;
      }

      this.logger.log(`Response stream completed, model=${model}`);
    } catch (error) {
      this.logger.error(
        `Response stream failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Send chat completion request
   */
  async chat(
    messages: ChatCompletionMessageParam[],
    options: ChatOptions = {},
  ): Promise<ChatCompletion> {
    const { model = 'gpt-5.4-mini', temperature = 0.7, max_tokens, top_p } = options;

    try {
      const startTime = Date.now();

      const response = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens,
        top_p,
        stream: false, // Ensure not streaming
      });

      const duration = Date.now() - startTime;

      const usage = (response as any).usage;

      // Track usage
      if (usage) {
        this.usageStats.totalPromptTokens += usage.prompt_tokens;
        this.usageStats.totalCompletionTokens += usage.completion_tokens;
        this.usageStats.totalCost += this.calculateCost(
          model,
          usage.prompt_tokens,
          usage.completion_tokens,
        );
        llmUsageTracker.record({
          model,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          cachedTokens:
            (usage as any).prompt_tokens_details?.cached_tokens ?? 0,
          tokenType: 'output',
        });
      }

      this.logger.log(
        `Chat completion: ${duration}ms, ${usage?.total_tokens || 0} tokens, model=${model}`,
      );

      return response as ChatCompletion;
    } catch (error) {
      this.logger.error(
        `Chat completion failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Stream chat completion (async generator)
   */
  async *streamChat(
    messages: ChatCompletionMessageParam[],
    options: ChatOptions = {},
  ): AsyncIterable<ChatCompletionChunk> {
    const { model = 'gpt-5.4-mini', temperature = 0.7, max_tokens, top_p } = options;

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens,
        top_p,
        stream: true,
      });

      for await (const chunk of stream) {
        yield chunk;
      }

      this.logger.log(`Chat stream completed, model=${model}`);
    } catch (error) {
      this.logger.error(`Chat stream failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate embedding for single text
   */
  async generateEmbedding(
    text: string,
    model: string = 'text-embedding-3-small',
  ): Promise<number[]> {
    try {
      const response = await this.withConnRetry('embedding', () =>
        this.client.embeddings.create({
          model,
          input: text,
        }),
      );

      const embedding = response.data[0].embedding;
      const usage = response.usage;

      // Track usage
      if (usage) {
        this.usageStats.totalPromptTokens += usage.prompt_tokens;
        this.usageStats.totalCost += this.calculateCost(
          model,
          usage.prompt_tokens,
          0,
        );
        llmUsageTracker.record({
          model,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: 0,
          tokenType: 'embedding',
        });
      }

      this.logger.debug(
        `Generated embedding: ${usage?.prompt_tokens || 0} tokens`,
      );

      return embedding;
    } catch (error) {
      this.logger.error(
        `Embedding generation failed (model=${model}, chars=${text?.length ?? 0}, ` +
          `retryable=${OpenAiService.isRetryableConnError(error)}): ${OpenAiService.describeError(error)}`,
        (error as Error)?.stack,
      );
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async generateEmbeddingBatch(
    texts: string[],
    model: string = 'text-embedding-3-small',
  ): Promise<number[][]> {
    try {
      const response = await this.withConnRetry('embedding-batch', () =>
        this.client.embeddings.create({
          model,
          input: texts,
        }),
      );

      const embeddings = response.data.map((item) => item.embedding);
      const usage = response.usage;

      // Track usage
      if (usage) {
        this.usageStats.totalPromptTokens += usage.prompt_tokens;
        this.usageStats.totalCost += this.calculateCost(
          model,
          usage.prompt_tokens,
          0,
        );
        llmUsageTracker.record({
          model,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: 0,
          tokenType: 'embedding',
        });
      }

      this.logger.log(
        `Generated ${embeddings.length} embeddings: ${usage?.prompt_tokens || 0} tokens`,
      );

      return embeddings;
    } catch (error) {
      this.logger.error(
        `Batch embedding generation failed (model=${model}, items=${texts?.length ?? 0}, ` +
          `retryable=${OpenAiService.isRetryableConnError(error)}): ${OpenAiService.describeError(error)}`,
        (error as Error)?.stack,
      );
      throw error;
    }
  }

  /**
   * Get current usage statistics
   */
  getUsageStats() {
    return { ...this.usageStats };
  }

  /**
   * Accept both legacy `json_schema` payloads and current SDK `schema` format.
   */
  private normalizeTextFormat(
    format: ResponseFormatTextConfig | LegacyJSONSchemaFormat,
  ): ResponseFormatTextConfig {
    if (
      format.type === 'json_schema' &&
      'json_schema' in format &&
      format.json_schema
    ) {
      return {
        type: 'json_schema',
        name: format.json_schema.name,
        schema: format.json_schema.schema,
        ...(format.json_schema.strict !== undefined
          ? { strict: format.json_schema.strict }
          : {}),
        ...(format.json_schema.description
          ? { description: format.json_schema.description }
          : {}),
      };
    }

    return format as ResponseFormatTextConfig;
  }

  /**
   * Calculate cost for API usage
   */
  private calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): number {
    const pricing = this.pricing[model] || this.pricing['gpt-5.4-mini'];
    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }
}
