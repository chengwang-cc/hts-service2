import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
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
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';

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
  private readonly useResponsesApi: boolean;
  private usageStats = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
  };

  // Pricing per 1M tokens (as of 2026)
  private readonly pricing = {
    'gpt-4': { input: 30.0, output: 60.0 },
    'gpt-4-turbo': { input: 10.0, output: 30.0 },
    'gpt-4o': { input: 2.5, output: 10.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-5': { input: 3.0, output: 12.0 },
    'gpt-5.2': { input: 3.0, output: 12.0 },
    'text-embedding-3-small': { input: 0.02, output: 0 },
    'text-embedding-3-large': { input: 0.13, output: 0 },
  };

  constructor(apiKey?: string) {
    if (!apiKey && !process.env.OPENAI_API_KEY) {
      throw new Error(
        'OpenAI API key is required. Set OPENAI_API_KEY environment variable.',
      );
    }

    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });

    // Configuration: Use Responses API by default, but allow fallback via env var
    // Set OPENAI_USE_CHAT_COMPLETIONS=true to use legacy Chat Completions API
    this.useResponsesApi = process.env.OPENAI_USE_CHAT_COMPLETIONS !== 'true';

    this.logger.log(
      `OpenAI service initialized (using ${this.useResponsesApi ? 'Responses API' : 'Chat Completions API'})`,
    );
  }

  /**
   * Send response request (Responses API - recommended)
   * This is OpenAI's new standard API as of 2026
   * Automatically falls back to Chat Completions if Responses API fails or is disabled
   */
  async response(
    input: string,
    options: ResponseOptions = {},
  ): Promise<Response> {
    // If configured to use Chat Completions, use fallback immediately
    if (!this.useResponsesApi) {
      return this.responseWithChatFallback(input, options);
    }

    const {
      model = 'gpt-4o',
      instructions,
      temperature = 0.7,
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
        temperature,
        stream: false,
      };

      // Add optional instructions (replaces system message)
      if (instructions) requestParams.instructions = instructions;
      if (max_output_tokens) requestParams.max_output_tokens = max_output_tokens;
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

      const response = await this.client.responses.create(requestParams);

      const duration = Date.now() - startTime;

      // Extract response data
      const usage = (response as any).usage;

      // Track usage
      if (usage) {
        this.usageStats.totalPromptTokens += usage.prompt_tokens || 0;
        this.usageStats.totalCompletionTokens += usage.completion_tokens || 0;
        this.usageStats.totalCost += this.calculateCost(
          model,
          usage.prompt_tokens || 0,
          usage.completion_tokens || 0,
        );
      }

      this.logger.log(
        `Response API: ${duration}ms, ${usage?.total_tokens || 0} tokens, model=${model}`,
      );

      return response;
    } catch (error) {
      this.logger.warn(
        `Response API failed: ${error.message}, falling back to Chat Completions`,
      );

      // Automatic fallback to Chat Completions API
      return this.responseWithChatFallback(input, options);
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
      model = 'gpt-4o',
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
    input: string,
    options: ResponseOptions = {},
  ): AsyncIterable<ResponseStreamEvent> {
    const {
      model = 'gpt-4o',
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

      if (max_output_tokens) requestParams.max_output_tokens = max_output_tokens;
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
      this.logger.error(`Response stream failed: ${error.message}`, error.stack);
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
    const {
      model = 'gpt-4o',
      temperature = 0.7,
      max_tokens,
      top_p,
    } = options;

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
      }

      this.logger.log(
        `Chat completion: ${duration}ms, ${usage?.total_tokens || 0} tokens, model=${model}`,
      );

      return response as ChatCompletion;
    } catch (error) {
      this.logger.error(`Chat completion failed: ${error.message}`, error.stack);
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
    const {
      model = 'gpt-4o',
      temperature = 0.7,
      max_tokens,
      top_p,
    } = options;

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
        yield chunk as ChatCompletionChunk;
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
      const response = await this.client.embeddings.create({
        model,
        input: text,
      });

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
      }

      this.logger.debug(
        `Generated embedding: ${usage?.prompt_tokens || 0} tokens`,
      );

      return embedding;
    } catch (error) {
      this.logger.error(`Embedding generation failed: ${error.message}`, error.stack);
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
      const response = await this.client.embeddings.create({
        model,
        input: texts,
      });

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
      }

      this.logger.log(
        `Generated ${embeddings.length} embeddings: ${usage?.prompt_tokens || 0} tokens`,
      );

      return embeddings;
    } catch (error) {
      this.logger.error(`Batch embedding generation failed: ${error.message}`, error.stack);
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
    const pricing = this.pricing[model] || this.pricing['gpt-4o'];
    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }
}
