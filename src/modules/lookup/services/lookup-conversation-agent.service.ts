import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { SearchService } from './search.service';
import { NoteResolutionService } from '@hts/knowledgebase';
import { UsageTrackingService } from '../../billing/services/usage-tracking.service';
import { LookupConversationSessionEntity } from '../entities/lookup-conversation-session.entity';
import { LookupConversationMessageEntity } from '../entities/lookup-conversation-message.entity';
import { LookupConversationFeedbackEntity } from '../entities/lookup-conversation-feedback.entity';

type AgentModel = 'claude-haiku' | 'gpt-5-nano';

/**
 * A clarification question with optional quick-reply chips.
 * Backward-compat: old DB rows may store plain strings — those are coerced.
 */
const ClarificationQuestionSchema = z.union([
  z.string().transform((q) => ({ question: q, options: [] as string[] })),
  z.object({
    question: z.string(),
    options: z.array(z.string()).default([]),
  }),
]);

export type ClarificationQuestion = { question: string; options: string[] };

const ConversationResponseSchema = z.object({
  answer: z.string(),
  recommendedHts: z.string().nullable().optional(),
  alternatives: z
    .array(
      z.object({
        hts: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  needsClarification: z.boolean().default(false),
  clarificationQuestions: z.array(ClarificationQuestionSchema).default([]),
  evidence: z
    .array(
      z.object({
        type: z.string().optional().default(''),
        source: z.string().optional().default(''),
        ref: z.string().optional().default(''),
      }),
    )
    .default([]),
  toolTrace: z.array(z.string()).default([]),
});

export type ConversationAgentOutput = z.infer<typeof ConversationResponseSchema>;

export type ConversationRole = 'user' | 'assistant';

export interface AdvancedConversationUsage {
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  overageApplied: boolean;
  overageChargeUsd: number;
}

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string | ConversationAgentOutput;
  createdAt: string;
}

export interface ConversationSession {
  id: string;
  organizationId?: string;
  userProfile?: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'closed';
  messages: ConversationMessage[];
  usage?: AdvancedConversationUsage;
}

const AGENT_SYSTEM_PROMPT = `You are an expert HTS (Harmonized Tariff Schedule) classification assistant.

Process:
1. Call hts_search_hybrid or hts_autocomplete to find candidate codes. One call is usually enough.
2. If you need to verify a specific code, use hts_lookup_exact.
3. When you have sufficient evidence, call provide_answer with your structured result.

Rules:
- Prefer specific leaf codes (e.g., 6109.10.00.04) over generic "Other" codes.
- If product details are ambiguous, set needsClarification=true with 1-3 focused questions.
- Provide alternatives only when there is genuine ambiguity between 2-3 codes.
- Do NOT run multiple searches for the same query — one hybrid search gives good results.
- Always end by calling provide_answer.

Clarification questions format:
Each clarification question MUST be a structured object with:
- "question": the question text
- "options": quick-reply chips for the UI
  - Yes/No questions → ["Yes", "No"]
  - Multiple-choice (material, color, type, end-use) → 3-5 most common values, e.g. ["Cotton", "Polyester", "Wool", "Blend"]
  - Open-ended (dimensions, page count, custom value) → [] (empty, user types freely)

Example clarificationQuestions:
[
  { "question": "What is the primary material?", "options": ["Cotton", "Polyester", "Wool", "Leather", "Other"] },
  { "question": "What is the intended use?", "options": ["Commercial", "Personal", "Industrial"] },
  { "question": "Is it battery-powered?", "options": ["Yes", "No"] },
  { "question": "What are the exact dimensions (length × width × height)?", "options": [] }
]`;

/**
 * Separate system prompt for the OpenAI RAG path.
 * No function-calling references — the model receives pre-fetched search results
 * and must output JSON directly. On follow-up turns (previous_response_id set),
 * the model already has full conversation context.
 */
const OPENAI_AGENT_SYSTEM_PROMPT = `You are an expert HTS (Harmonized Tariff Schedule) classification assistant.

When HTS search results are provided, use them to recommend the best matching leaf code.
When the user provides answers to clarification questions, use ALL provided answers to give a definitive final classification.

Output ONLY valid JSON — no extra text, no markdown fences:
{"answer":"1-2 sentence explanation","recommendedHts":"leaf code or null","alternatives":[{"hts":"code","reason":"why"}],"confidence":0.0,"needsClarification":false,"clarificationQuestions":[{"question":"text","options":["opt1","opt2"]}],"evidence":[],"toolTrace":[]}

Rules:
- MANDATORY: If confidence < 0.7, you MUST set needsClarification=true and ask 2-3 targeted questions to resolve the ambiguity. Never return confidence < 0.7 with an empty clarificationQuestions array.
- If the user has already answered clarification questions, give a confident final answer — do NOT repeat the same questions.
- Prefer specific leaf codes (e.g., 6109.10.00.04) over generic "Other" codes.
- clarificationQuestions options: ["Yes","No"] for yes/no; 3-5 values for multiple-choice; [] for open-ended text.
- For media/printed matter: ask about format (bound book vs loose issues), page count range, and audience (children vs general).
- For apparel: ask about primary material, gender/age group, and whether knitted or woven.
- For electronics: ask about primary function and whether battery-powered.`;

@Injectable()
export class LookupConversationAgentService {
  private readonly logger = new Logger(LookupConversationAgentService.name);
  private readonly ADVANCED_SESSION_DAILY_LIMIT = 20;
  private readonly ADVANCED_SESSION_OVERAGE_CHARGE_USD = 0.1;
  private readonly anthropic: Anthropic;
  private readonly openai: OpenAI;

  constructor(
    @InjectRepository(LookupConversationSessionEntity)
    private readonly sessionRepository: Repository<LookupConversationSessionEntity>,
    @InjectRepository(LookupConversationMessageEntity)
    private readonly messageRepository: Repository<LookupConversationMessageEntity>,
    @InjectRepository(LookupConversationFeedbackEntity)
    private readonly feedbackRepository: Repository<LookupConversationFeedbackEntity>,
    private readonly searchService: SearchService,
    private readonly noteResolutionService: NoteResolutionService,
    private readonly usageTrackingService: UsageTrackingService,
    private readonly config: ConfigService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: config.get<string>('ANTHROPIC_API_KEY') ?? process.env.ANTHROPIC_API_KEY,
      timeout: 60_000,
      maxRetries: 0,
    });
    this.openai = new OpenAI({
      apiKey: config.get<string>('OPENAI_API_KEY') ?? process.env.OPENAI_API_KEY,
      timeout: 60_000,
      maxRetries: 0,
    });
  }

  private getConfiguredModel(): AgentModel {
    const model = this.config.get<string>('LOOKUP_AGENT_MODEL', 'claude-haiku');
    return model === 'gpt-5-nano' ? 'gpt-5-nano' : 'claude-haiku';
  }

  async createConversation(params: {
    organizationId: string;
    userId?: string;
    userProfile?: string;
  }): Promise<ConversationSession> {
    const { start, end } = this.getUtcDayWindow();
    const sessionsToday = await this.sessionRepository
      .createQueryBuilder('session')
      .where('session.organizationId = :organizationId', {
        organizationId: params.organizationId,
      })
      .andWhere('session.createdAt >= :start', { start })
      .andWhere('session.createdAt < :end', { end })
      .getCount();

    const overageApplied = sessionsToday >= this.ADVANCED_SESSION_DAILY_LIMIT;
    const session = this.sessionRepository.create({
      organizationId: params.organizationId,
      userProfile: params.userProfile || null,
      status: 'active',
      contextJson: null,
    });
    const saved = await this.sessionRepository.save(session);

    await this.trackAdvancedSessionUsage(params.organizationId, {
      sessionId: saved.id,
      userId: params.userId || null,
      overageApplied,
    });

    const usedToday = sessionsToday + 1;
    const usage: AdvancedConversationUsage = {
      dailyLimit: this.ADVANCED_SESSION_DAILY_LIMIT,
      usedToday,
      remainingToday: Math.max(0, this.ADVANCED_SESSION_DAILY_LIMIT - usedToday),
      overageApplied,
      overageChargeUsd: overageApplied
        ? this.ADVANCED_SESSION_OVERAGE_CHARGE_USD
        : 0,
    };

    return this.toConversationSession(saved, [], usage);
  }

  async getConversation(
    conversationId: string,
    organizationId: string,
  ): Promise<Omit<ConversationSession, 'messages'> & { messageCount: number }> {
    const session = await this.requireSession(conversationId, organizationId);
    const messageCount = await this.messageRepository.count({
      where: { sessionId: conversationId },
    });
    return {
      id: session.id,
      organizationId: session.organizationId || undefined,
      userProfile: session.userProfile || undefined,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      status: session.status,
      messageCount,
    };
  }

  async getMessages(
    conversationId: string,
    organizationId: string,
    limit = 100,
  ): Promise<{ conversationId: string; count: number; messages: ConversationMessage[] }> {
    await this.requireSession(conversationId, organizationId);
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = await this.messageRepository
      .createQueryBuilder('m')
      .where('m.sessionId = :conversationId', { conversationId })
      .orderBy('m.createdAt', 'DESC')
      .limit(safeLimit)
      .getMany();

    const messages = rows.reverse().map((row) => this.toConversationMessage(row));
    return {
      conversationId,
      count: messages.length,
      messages,
    };
  }

  /**
   * Enqueues a conversation message for async processing via pg-boss.
   * Returns immediately with a pending messageId; caller should poll getMessageStatus().
   */
  async enqueueMessage(
    conversationId: string,
    organizationId: string,
    message: string,
  ): Promise<{
    conversationId: string;
    messageId: string;
    status: 'pending';
  }> {
    const session = await this.requireSession(conversationId, organizationId);
    const safeMessage = message.trim();
    if (!safeMessage) {
      throw new Error('Message cannot be empty');
    }

    // Persist user message immediately
    const userMessage = this.messageRepository.create({
      sessionId: session.id,
      role: 'user',
      contentJson: { type: 'text', text: safeMessage },
      toolTraceJson: null,
      tokenUsage: null,
      status: 'complete',
      errorMessage: null,
    });
    await this.messageRepository.save(userMessage);

    // Create a pending placeholder for the assistant reply
    const assistantPlaceholder = this.messageRepository.create({
      sessionId: session.id,
      role: 'assistant',
      contentJson: {},
      toolTraceJson: null,
      tokenUsage: null,
      status: 'pending',
      errorMessage: null,
    });
    const savedPlaceholder = await this.messageRepository.save(assistantPlaceholder);

    return {
      conversationId,
      messageId: savedPlaceholder.id,
      status: 'pending',
    };
  }

  /**
   * Runs the AI agent and writes the result into the pending assistant message.
   * Called by the pg-boss worker — must NOT be called from an HTTP handler directly.
   */
  async processMessage(
    conversationId: string,
    messageId: string,
    message: string,
  ): Promise<void> {
    const model = this.getConfiguredModel();
    await this.messageRepository.update(messageId, { status: 'processing' });

    const toolTrace: string[] = [];
    let normalized: ConversationAgentOutput;

    try {
      const session = await this.sessionRepository.findOne({ where: { id: conversationId } });
      if (!session) {
        throw new InternalServerErrorException(`Session ${conversationId} not found during processing`);
      }

      const history = await this.getRecentMessages(session.id, 8);
      const clarificationEchoGuard = this.buildClarificationEchoGuardResponse(
        history,
        message,
      );

      let newOpenAiResponseId: string | null = null;

      if (clarificationEchoGuard) {
        normalized = clarificationEchoGuard;
      } else {
        const prompt = this.buildTurnPrompt(history);
        if (model === 'gpt-5-nano') {
          const ctx = (session.contextJson as Record<string, unknown> | null) ?? null;
          const previousResponseId = ctx?.openaiPreviousResponseId as string | null ?? null;
          const result = await this.runOpenAIAgent(message, prompt, toolTrace, previousResponseId, ctx);
          normalized = result.output;
          newOpenAiResponseId = result.responseId;
        } else {
          normalized = await this.runClaudeAgent(prompt, toolTrace);
        }
      }

      // Validate that recommendedHts and alternatives exist in the DB.
      // LLMs can hallucinate HTS numbers that look plausible but don't exist.
      normalized = await this.validateHtsCodes(normalized);

      await this.messageRepository.update(messageId, {
        contentJson: normalized as Record<string, any>,
        toolTraceJson: normalized.toolTrace,
        status: 'complete',
        errorMessage: null,
      });

      const existingCtx = (session.contextJson as Record<string, unknown> | null) ?? {};
      session.contextJson = {
        ...existingCtx,
        lastToolTrace: normalized.toolTrace,
        lastRecommendedHts: normalized.recommendedHts || null,
        lastConfidence: normalized.confidence,
        // Store the original product query on first turn so subsequent turns can re-search with it
        productQuery: existingCtx.productQuery ?? message,
        ...(newOpenAiResponseId ? { openaiPreviousResponseId: newOpenAiResponseId } : {}),
      };
      await this.sessionRepository.save(session);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.logger.error(`processMessage failed for messageId=${messageId}: ${errorText}`);
      await this.messageRepository.update(messageId, {
        status: 'failed',
        errorMessage: errorText,
      });
    }
  }

  /**
   * Polls the status of a pending assistant message.
   */
  async getMessageStatus(
    messageId: string,
    conversationId: string,
    organizationId: string,
  ): Promise<{
    status: 'pending' | 'processing' | 'complete' | 'failed';
    messageId: string;
    response?: ConversationAgentOutput;
    error?: string;
  }> {
    await this.requireSession(conversationId, organizationId);

    const message = await this.messageRepository.findOne({
      where: { id: messageId, sessionId: conversationId },
    });
    if (!message) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }

    if (message.status === 'complete') {
      return {
        status: 'complete',
        messageId: message.id,
        response: this.normalizeAgentOutput(message.contentJson, message.toolTraceJson || []),
      };
    }
    if (message.status === 'failed') {
      return {
        status: 'failed',
        messageId: message.id,
        error: message.errorMessage || 'Processing failed',
      };
    }
    return { status: message.status, messageId: message.id };
  }

  async recordFeedback(
    conversationId: string,
    organizationId: string,
    payload: {
      isCorrect: boolean;
      messageId?: string;
      chosenHts?: string;
      comment?: string;
    },
  ): Promise<{
    conversationId: string;
    feedbackId: string;
    storedAt: string;
  }> {
    await this.requireSession(conversationId, organizationId);

    let feedbackMetadata: Record<string, any> | null = null;

    if (payload.messageId) {
      const message = await this.messageRepository.findOne({
        where: { id: payload.messageId, sessionId: conversationId },
      });
      if (!message) {
        throw new NotFoundException(
          `Message ${payload.messageId} not found in conversation ${conversationId}`,
        );
      }

      // Find the user message that preceded this assistant reply — its text is
      // the original search query for which we want to log intent rules.
      const userMessage = await this.messageRepository
        .createQueryBuilder('m')
        .where('m.sessionId = :sessionId', { sessionId: conversationId })
        .andWhere('m.role = :role', { role: 'user' })
        .andWhere('m.createdAt <= :ts', { ts: message.createdAt })
        .orderBy('m.createdAt', 'DESC')
        .limit(1)
        .getOne();

      const userQuery: string | undefined =
        typeof userMessage?.contentJson?.text === 'string'
          ? userMessage.contentJson.text
          : undefined;

      if (userQuery) {
        const matchedRuleIds = this.searchService.computeMatchedRuleIds(userQuery);
        feedbackMetadata = { matchedRuleIds, queryText: userQuery };
      }
    }

    const feedback = this.feedbackRepository.create({
      sessionId: conversationId,
      messageId: payload.messageId || null,
      isCorrect: payload.isCorrect,
      chosenHts: payload.chosenHts || null,
      comment: payload.comment || null,
      metadata: feedbackMetadata,
    });

    const saved = await this.feedbackRepository.save(feedback);
    return {
      conversationId,
      feedbackId: saved.id,
      storedAt: saved.createdAt.toISOString(),
    };
  }

  /**
   * Runs the Claude Haiku agent with up to 3 turns of tool use.
   * Uses the `provide_answer` tool to return a structured output.
   */
  private async runClaudeAgent(
    prompt: string,
    toolTrace: string[],
  ): Promise<ConversationAgentOutput> {
    const researchTools = this.buildAnthropicTools();
    const answerTool = this.buildAnswerTool();
    const allTools: Anthropic.Tool[] = [...researchTools, answerTool];

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
    const MAX_TURNS = 3;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const isLastTurn = turn === MAX_TURNS - 1;

      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: AGENT_SYSTEM_PROMPT,
        tools: allTools,
        messages,
        tool_choice: isLastTurn
          ? { type: 'tool', name: 'provide_answer' }
          : { type: 'auto' },
      });

      // If the model called provide_answer, return the structured result
      const answerBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'provide_answer',
      );
      if (answerBlock) {
        return this.normalizeAgentOutput(answerBlock.input, toolTrace);
      }

      if (response.stop_reason !== 'tool_use') {
        // Model ended without calling provide_answer — extract text and fall back
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        return this.normalizeAgentOutput(text, toolTrace);
      }

      // Execute all tool calls in parallel, then continue the conversation
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const result = await this.executeAnthropicTool(block.name, block.input, toolTrace);
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: JSON.stringify(result),
          };
        }),
      );

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
    }

    return this.normalizeAgentOutput(
      { answer: 'Unable to produce a structured answer within the turn limit.', confidence: 0, needsClarification: true, clarificationQuestions: [], alternatives: [], evidence: [], toolTrace },
      toolTrace,
    );
  }

  /**
   * Runs the OpenAI GPT-5-nano agent using the Responses API.
   *
   * First turn  : fast keyword search → embed results in prompt → single API call.
   * Subsequent turns: pass `previous_response_id` — the model retains the full
   * conversation context (search results + prior Q&A) without re-fetching.
   */
  private async runOpenAIAgent(
    userQuery: string,
    prompt: string,
    toolTrace: string[],
    previousResponseId?: string | null,
    sessionCtx?: Record<string, unknown> | null,
  ): Promise<{ output: ConversationAgentOutput; responseId: string }> {
    let inputText: string;

    // Helper: search using autocomplete (keyword + semantic via DGX pgvector)
    const fetchCandidates = async (query: string) => {
      const t0 = Date.now();
      const results = await this.searchService.autocomplete(query, 10);
      this.logger.log(`Autocomplete search: ${Date.now() - t0}ms, ${results.length} results`);
      return results.slice(0, 10).map((r: Record<string, unknown>) => ({
        htsNumber: r['htsNumber'],
        description: r['description'],
        score: r['score'],
        breadcrumb: Array.isArray(r['fullDescription'])
          ? (r['fullDescription'] as string[]).slice(-2).join(' › ')
          : null,
      }));
    };

    if (previousResponseId) {
      toolTrace.push('conversation_continue');
      this.logger.log(`GPT-5-nano: continuing thread previous_response_id=${previousResponseId}`);

      // If no confirmed HTS code yet, re-run the search with the original product query
      // so the model has DB-verified candidates instead of answering from training memory.
      const lastRecommendedHts = sessionCtx?.lastRecommendedHts as string | null ?? null;
      const productQuery = sessionCtx?.productQuery as string | null ?? userQuery;

      if (!lastRecommendedHts) {
        toolTrace.push('hts_search_refresh');
        const candidates = await fetchCandidates(productQuery);
        inputText = [
          userQuery,
          '',
          `Refreshed HTS candidates for "${productQuery}" (${candidates.length} results — pick ONLY from these):`,
          JSON.stringify(candidates),
          '',
          'Respond in JSON format.',
        ].join('\n');
      } else {
        inputText = `${userQuery}\n\nRespond in JSON format.`;
      }
    } else {
      // First turn — search with autocomplete (keyword + semantic) and embed results
      toolTrace.push('hts_search_hybrid');
      const candidates = await fetchCandidates(userQuery);

      inputText = [
        prompt,
        '',
        `HTS search results for "${userQuery}" (${candidates.length} candidates — pick ONLY from these):`,
        JSON.stringify(candidates),
        '',
        'Respond in JSON format.',
      ].join('\n');
    }

    const t0 = Date.now();
    const response = await this.openai.responses.create({
      model: 'gpt-5-nano',
      instructions: OPENAI_AGENT_SYSTEM_PROMPT,
      input: inputText,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      text: { format: { type: 'json_object' } },
    });
    this.logger.log(
      `GPT-5-nano Responses API: ${Date.now() - t0}ms, status=${response.status}, id=${response.id}`,
    );

    return {
      output: this.normalizeAgentOutput(response.output_text, toolTrace),
      responseId: response.id,
    };
  }

  private buildAnthropicTools(): Anthropic.Tool[] {
    return [
      {
        name: 'hts_autocomplete',
        description: 'Autocomplete HTS candidates using code or text query. Use for fast candidate discovery.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string' },
            limit: { type: 'number', description: 'Max results (1–20), default 10' },
          },
          required: ['query'],
        },
      },
      {
        name: 'hts_search_hybrid',
        description: 'Run high-accuracy HTS search using lexical + semantic retrieval and ranking.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string' },
            limit: { type: 'number', description: 'Max results (1–30), default 10' },
          },
          required: ['query'],
        },
      },
      {
        name: 'hts_lookup_exact',
        description: 'Fetch exact HTS entry details by HTS number for evidence validation.',
        input_schema: {
          type: 'object' as const,
          properties: { htsNumber: { type: 'string' } },
          required: ['htsNumber'],
        },
      },
      {
        name: 'hts_compare_candidates',
        description: 'Compare candidate HTS codes side-by-side for product fit and ambiguity handling.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string' },
            candidateCodes: { type: 'array', items: { type: 'string' }, description: '1–10 HTS codes to compare' },
          },
          required: ['query', 'candidateCodes'],
        },
      },
      {
        name: 'hts_get_notes',
        description: 'Resolve legal note references from HTS general/other columns for a specific HTS code.',
        input_schema: {
          type: 'object' as const,
          properties: { htsNumber: { type: 'string' } },
          required: ['htsNumber'],
        },
      },
    ];
  }

  private buildAnswerTool(): Anthropic.Tool {
    return {
      name: 'provide_answer',
      description: 'Return the final structured HTS classification result. Call this once you have enough evidence.',
      input_schema: {
        type: 'object' as const,
        properties: {
          answer: { type: 'string', description: 'Natural-language explanation of the classification' },
          recommendedHts: { type: 'string', description: 'Recommended HTS leaf code, or null if unknown', nullable: true },
          alternatives: {
            type: 'array',
            items: {
              type: 'object',
              properties: { hts: { type: 'string' }, reason: { type: 'string' } },
              required: ['hts', 'reason'],
            },
          },
          confidence: { type: 'number', description: 'Classification confidence 0–1' },
          needsClarification: { type: 'boolean' },
          clarificationQuestions: {
            type: 'array',
            description: 'Structured questions with quick-reply options for the UI.',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: 'The clarification question text' },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Quick-reply chips: ["Yes","No"] for polar, list for multiple-choice, [] for open-ended',
                },
              },
              required: ['question', 'options'],
            },
          },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                source: { type: 'string' },
                ref: { type: 'string' },
              },
              required: ['type', 'source', 'ref'],
            },
          },
          toolTrace: { type: 'array', items: { type: 'string' } },
        },
        required: ['answer', 'confidence', 'needsClarification', 'clarificationQuestions', 'alternatives', 'evidence', 'toolTrace'],
      },
    };
  }

  private async executeAnthropicTool(
    name: string,
    input: unknown,
    toolTrace: string[],
  ): Promise<unknown> {
    const p = input as Record<string, any>;
    switch (name) {
      case 'hts_autocomplete': {
        toolTrace.push('hts_autocomplete');
        const acResults = await this.searchService.autocomplete(p['query'], p['limit'] ?? 8);
        return acResults.slice(0, 8).map((r: Record<string, unknown>) => ({
          htsNumber: r['htsNumber'],
          description: r['description'],
          chapter: r['chapter'],
          score: r['score'],
        }));
      }
      case 'hts_search_hybrid': {
        toolTrace.push('hts_search_hybrid');
        const searchResults = await this.searchService.hybridSearch(p['query'], p['limit'] ?? 8);
        // Trim to reduce OpenAI context size — only essential fields, max 8 results
        return searchResults.slice(0, 8).map((r: Record<string, unknown>) => ({
          htsNumber: r['htsNumber'],
          description: r['description'],
          breadcrumb: Array.isArray(r['fullDescription'])
            ? (r['fullDescription'] as string[]).slice(-2).join(' › ')
            : null,
          score: typeof r['score'] === 'number' ? Math.round(r['score'] * 1000) / 1000 : r['score'],
        }));
      }
      case 'hts_lookup_exact': {
        toolTrace.push('hts_lookup_exact');
        const row = await this.searchService.findByHtsNumber(p['htsNumber']);
        if (!row) return null;
        return {
          htsNumber: row.htsNumber,
          chapter: row.chapter,
          description: row.description,
          breadcrumb: (row.fullDescription || []).slice(-2).join(' › '),
          general: row.general,
          other: row.other,
        };
      }
      case 'hts_compare_candidates': {
        toolTrace.push('hts_compare_candidates');
        const rows = await Promise.all(
          (p['candidateCodes'] as string[]).map((code) => this.searchService.findByHtsNumber(code)),
        );
        const queryTokens = this.tokenize(p['query']);
        return rows
          .filter((row): row is NonNullable<typeof row> => row !== null)
          .map((row) => {
            const description = (row.description || '').toLowerCase();
            const coverage =
              queryTokens.length === 0
                ? 0
                : queryTokens.filter((t) => description.includes(t)).length / queryTokens.length;
            return {
              htsNumber: row.htsNumber,
              description: row.description || '',
              chapter: row.chapter,
              coverage,
              fullDescription: row.fullDescription || [],
            };
          });
      }
      case 'hts_get_notes': {
        toolTrace.push('hts_get_notes');
        const row = await this.searchService.findByHtsNumber(p['htsNumber']);
        if (!row) return [];
        const resolvedYear = this.resolveYear(undefined, row.sourceVersion);
        const candidates: Array<{ sourceColumn: 'general' | 'other'; referenceText: string }> = [];
        if (this.hasLikelyNoteReference(row.general)) {
          candidates.push({ sourceColumn: 'general', referenceText: row.general || '' });
        }
        if (this.hasLikelyNoteReference(row.other)) {
          candidates.push({ sourceColumn: 'other', referenceText: row.other || '' });
        }
        const notes: Array<Record<string, any>> = [];
        for (const candidate of candidates) {
          const resolved = await this.noteResolutionService.resolveNoteReference(
            row.htsNumber,
            candidate.referenceText,
            candidate.sourceColumn,
            resolvedYear,
            { persistResolution: false },
          );
          if (resolved) {
            notes.push({ sourceColumn: candidate.sourceColumn, referenceText: candidate.referenceText, ...resolved });
          }
        }
        return notes;
      }
      default:
        this.logger.warn(`Unknown tool called by Claude agent: ${name}`);
        return { error: `Unknown tool: ${name}` };
    }
  }

  private buildTurnPrompt(history: ConversationMessage[]): string {
    const latestUserMessage = [...history]
      .reverse()
      .find((msg) => msg.role === 'user' && typeof msg.content === 'string');
    const latestUserText =
      latestUserMessage && typeof latestUserMessage.content === 'string'
        ? latestUserMessage.content
        : '';

    const latestAssistantWithClarifications = [...history]
      .reverse()
      .find(
        (msg) =>
          msg.role === 'assistant' &&
          typeof msg.content !== 'string' &&
          Array.isArray(msg.content.clarificationQuestions) &&
          msg.content.clarificationQuestions.length > 0,
      );
    const priorClarificationQuestions: ClarificationQuestion[] =
      latestAssistantWithClarifications &&
      typeof latestAssistantWithClarifications.content !== 'string'
        ? latestAssistantWithClarifications.content.clarificationQuestions || []
        : [];

    const normalizedLatestUser = this.normalizeQuestionText(latestUserText);
    const echoedClarification = priorClarificationQuestions.find(
      (q) =>
        this.normalizeQuestionText(q.question) === normalizedLatestUser &&
        normalizedLatestUser.length > 0,
    );

    const serializedHistory = history
      .map((msg) => {
        if (msg.role === 'assistant') {
          const content =
            typeof msg.content === 'string'
              ? msg.content
              : `${msg.content.answer} (recommended=${msg.content.recommendedHts || 'n/a'}, confidence=${msg.content.confidence}, needsClarification=${msg.content.needsClarification}, clarificationQuestions=${(msg.content.clarificationQuestions || []).map((q) => q.question).join(' | ')})`;
          return `assistant: ${content}`;
        }
        return `user: ${String(msg.content)}`;
      })
      .join('\n');

    const antiLoopRule = echoedClarification
      ? `Important anti-loop rule:
- The latest user message repeats a prior clarification question verbatim: "${echoedClarification.question}".
- Do NOT repeat the same clarification list.
- Ask for the user's direct answer value in one concise sentence (for example: "general audience" or "children").`
      : '';

    return `Conversation context:
${serializedHistory}

${antiLoopRule}

Respond using the structured schema.`;
  }

  /**
   * Check that every HTS code the LLM recommended actually exists in the DB.
   * Nulls out recommendedHts and filters alternatives for any hallucinated codes.
   * If recommendedHts is nulled, confidence is also dropped so the UI prompts
   * for clarification rather than displaying a broken result.
   */
  private async validateHtsCodes(
    output: ConversationAgentOutput,
  ): Promise<ConversationAgentOutput> {
    // Collect all codes to check in one batch
    const codesToCheck = new Set<string>();
    if (output.recommendedHts) codesToCheck.add(output.recommendedHts);
    for (const alt of output.alternatives ?? []) {
      if (alt.hts) codesToCheck.add(alt.hts);
    }
    if (codesToCheck.size === 0) return output;

    const existing = await Promise.all(
      [...codesToCheck].map((code) => this.searchService.findByHtsNumber(code)),
    );
    const validCodes = new Set(
      existing.filter(Boolean).map((e) => e!.htsNumber),
    );

    const invalidCodes = [...codesToCheck].filter((c) => !validCodes.has(c));
    if (invalidCodes.length === 0) return output;

    this.logger.warn(
      `Hallucinated HTS codes removed from agent output: ${invalidCodes.join(', ')}`,
    );

    const validatedRecommended = output.recommendedHts && validCodes.has(output.recommendedHts)
      ? output.recommendedHts
      : null;

    const validatedAlternatives = (output.alternatives ?? []).filter(
      (alt) => alt.hts && validCodes.has(alt.hts),
    );

    return {
      ...output,
      recommendedHts: validatedRecommended,
      alternatives: validatedAlternatives,
      // Drop confidence when the primary recommendation was invalid
      confidence: validatedRecommended === null && output.recommendedHts !== null
        ? Math.min(output.confidence, 0.5)
        : output.confidence,
      // Force clarification if we lost the recommended code
      needsClarification: validatedRecommended === null && output.recommendedHts !== null
        ? true
        : output.needsClarification,
    };
  }

  private normalizeAgentOutput(
    rawOutput: unknown,
    toolTrace: string[],
  ): ConversationAgentOutput {
    let output = rawOutput;
    if (typeof rawOutput === 'string') {
      try {
        output = JSON.parse(rawOutput);
      } catch {
        output = {
          answer: rawOutput,
          recommendedHts: null,
          alternatives: [],
          confidence: 0.5,
          needsClarification: false,
          clarificationQuestions: [],
          evidence: [],
          toolTrace,
        };
      }
    }

    const parsed = ConversationResponseSchema.safeParse(output);
    if (!parsed.success) {
      this.logger.warn(
        `Conversation agent returned non-conforming schema: ${parsed.error.message}`,
      );
      return {
        answer:
          'I could not produce a structured recommendation. Please refine the product details.',
        recommendedHts: null,
        alternatives: [],
        confidence: 0,
        needsClarification: true,
        clarificationQuestions: [
          { question: 'What is the exact product category and use case?', options: [] },
          { question: 'Can you provide material/composition and format details?', options: [] },
        ],
        evidence: [],
        toolTrace,
      };
    }

    const data = parsed.data;

    // Safety net: enforce the confidence/clarification invariant.
    // If the model returns low confidence but no questions, inject generic ones
    // so the UI always has something to show rather than a dead-end low-confidence answer.
    if (data.confidence < 0.7 && data.clarificationQuestions.length === 0) {
      data.needsClarification = true;
      data.clarificationQuestions = [
        {
          question: 'Can you describe the product in more detail? (materials, primary function, intended use)',
          options: [],
        },
        {
          question: 'Is this for personal use, commercial retail, or as a component/part?',
          options: ['Personal use', 'Commercial / retail sale', 'Industrial / component use'],
        },
      ];
    }

    const uniqueTrace = [...new Set([...data.toolTrace, ...toolTrace])];
    return {
      ...data,
      toolTrace: uniqueTrace,
    };
  }

  private async requireSession(
    conversationId: string,
    organizationId: string,
  ): Promise<LookupConversationSessionEntity> {
    const session = await this.sessionRepository.findOne({
      where: { id: conversationId },
    });
    if (!session) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }
    if (session.organizationId !== organizationId) {
      throw new ForbiddenException('Access denied for this conversation');
    }
    return session;
  }

  private async getRecentMessages(
    conversationId: string,
    limit: number,
  ): Promise<ConversationMessage[]> {
    const rows = await this.messageRepository
      .createQueryBuilder('m')
      .where('m.sessionId = :conversationId', { conversationId })
      .andWhere('m.status = :status', { status: 'complete' })
      .orderBy('m.createdAt', 'DESC')
      .limit(limit)
      .getMany();
    return rows.reverse().map((row) => this.toConversationMessage(row));
  }

  private toConversationSession(
    row: LookupConversationSessionEntity,
    messages: ConversationMessage[],
    usage?: AdvancedConversationUsage,
  ): ConversationSession {
    return {
      id: row.id,
      organizationId: row.organizationId || undefined,
      userProfile: row.userProfile || undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      status: row.status,
      messages,
      usage,
    };
  }

  private toConversationMessage(
    row: LookupConversationMessageEntity,
  ): ConversationMessage {
    const contentJson = row.contentJson || {};
    let content: string | ConversationAgentOutput = '';
    if (row.role === 'assistant') {
      content = this.normalizeAgentOutput(contentJson, row.toolTraceJson || []);
    } else if (typeof contentJson.text === 'string') {
      content = contentJson.text;
    } else {
      content = JSON.stringify(contentJson);
    }

    return {
      id: row.id,
      role: row.role,
      content,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private tokenize(input: string): string[] {
    const tokens: string[] = (input || '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
    return [...new Set(tokens.filter((token) => token.length > 1))];
  }

  private normalizeQuestionText(input: string): string {
    return (input || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private buildClarificationEchoGuardResponse(
    history: ConversationMessage[],
    latestUserText: string,
  ): ConversationAgentOutput | null {
    const latestAssistantWithClarifications = [...history]
      .reverse()
      .find(
        (msg) =>
          msg.role === 'assistant' &&
          typeof msg.content !== 'string' &&
          Array.isArray(msg.content.clarificationQuestions) &&
          msg.content.clarificationQuestions.length > 0,
      );

    if (
      !latestAssistantWithClarifications ||
      typeof latestAssistantWithClarifications.content === 'string'
    ) {
      return null;
    }

    const clarificationQuestions: ClarificationQuestion[] =
      latestAssistantWithClarifications.content.clarificationQuestions || [];
    const normalizedLatestUser = this.normalizeQuestionText(latestUserText);
    if (!normalizedLatestUser) {
      return null;
    }

    const echoedQuestion = clarificationQuestions.find(
      (q) => this.normalizeQuestionText(q.question) === normalizedLatestUser,
    );
    if (!echoedQuestion) {
      return null;
    }

    const remainingQuestions = clarificationQuestions.filter(
      (q) => this.normalizeQuestionText(q.question) !== normalizedLatestUser,
    );
    const exampleAnswer = this.buildClarificationAnswerExample(echoedQuestion);

    return {
      answer: `Please answer this clarification directly: "${echoedQuestion.question}". Example answer: ${exampleAnswer}.`,
      recommendedHts: null,
      alternatives: [],
      confidence: 0.1,
      needsClarification: true,
      clarificationQuestions:
        remainingQuestions.length > 0 ? remainingQuestions : [echoedQuestion],
      evidence: [],
      toolTrace: ['clarification_echo_guard'],
    };
  }

  private buildClarificationAnswerExample(question: ClarificationQuestion): string {
    // Prefer structured options if available
    if (question.options && question.options.length >= 2) {
      return `"${question.options[0]}" or "${question.options[question.options.length - 1]}"`;
    }
    // Fallback: scan question text
    const cleaned = (question.question || '').replace(/[?]+$/g, '').trim();
    if (/\b(yes|no)\b/i.test(cleaned)) return '"yes" or "no"';
    if (/\bpage|pages\b/i.test(cleaned)) return '"32 pages"';
    if (/\bcountry|destination|jurisdiction\b/i.test(cleaned)) return '"United States"';
    if (/\bmaterial|composition\b/i.test(cleaned)) return '"100% paper"';
    return '"physical print" or "digital"';
  }

  private hasLikelyNoteReference(value: string | null | undefined): boolean {
    if (!value) {
      return false;
    }
    return /note\s+[0-9]/i.test(value);
  }

  private resolveYear(
    year: number | undefined,
    sourceVersion: string | null,
  ): number {
    if (
      typeof year === 'number' &&
      Number.isInteger(year) &&
      year >= 1900 &&
      year <= 9999
    ) {
      return year;
    }
    if (sourceVersion) {
      const match = sourceVersion.match(/(19|20)\d{2}/);
      if (match) {
        return parseInt(match[0], 10);
      }
    }
    return new Date().getFullYear();
  }

  private getUtcDayWindow(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  private async trackAdvancedSessionUsage(
    organizationId: string,
    params: {
      sessionId: string;
      userId: string | null;
      overageApplied: boolean;
    },
  ): Promise<void> {
    const metadata = {
      sessionId: params.sessionId,
      userId: params.userId,
      channel: 'lookup.conversation',
      unitPriceUsd: this.ADVANCED_SESSION_OVERAGE_CHARGE_USD,
    };

    try {
      await this.usageTrackingService.trackUsage(
        organizationId,
        'advancedSearch.sessions',
        1,
        metadata,
      );

      if (params.overageApplied) {
        await this.usageTrackingService.trackUsage(
          organizationId,
          'advancedSearch.overageSessions',
          1,
          {
            ...metadata,
            chargeUsd: this.ADVANCED_SESSION_OVERAGE_CHARGE_USD,
          },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to track advanced conversation usage for organization=${organizationId}: ${message}`,
      );
    }
  }
}
