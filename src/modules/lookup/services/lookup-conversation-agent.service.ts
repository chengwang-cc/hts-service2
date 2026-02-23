import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { SearchService } from './search.service';
import { NoteResolutionService } from '@hts/knowledgebase';
import { UsageTrackingService } from '../../billing/services/usage-tracking.service';
import { LookupConversationSessionEntity } from '../entities/lookup-conversation-session.entity';
import { LookupConversationMessageEntity } from '../entities/lookup-conversation-message.entity';
import { LookupConversationFeedbackEntity } from '../entities/lookup-conversation-feedback.entity';

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
  clarificationQuestions: z.array(z.string()).default([]),
  evidence: z
    .array(
      z.object({
        type: z.string(),
        source: z.string(),
        ref: z.string(),
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

@Injectable()
export class LookupConversationAgentService {
  private readonly logger = new Logger(LookupConversationAgentService.name);
  private readonly ADVANCED_SESSION_DAILY_LIMIT = 20;
  private readonly ADVANCED_SESSION_OVERAGE_CHARGE_USD = 0.1;

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
  ) {}

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

  async sendMessage(
    conversationId: string,
    organizationId: string,
    message: string,
  ): Promise<{
    conversationId: string;
    response: ConversationAgentOutput;
    messageId: string;
    toolTrace: string[];
  }> {
    const session = await this.requireSession(conversationId, organizationId);
    const safeMessage = message.trim();
    if (!safeMessage) {
      throw new Error('Message cannot be empty');
    }

    const userMessage = this.messageRepository.create({
      sessionId: session.id,
      role: 'user',
      contentJson: { type: 'text', text: safeMessage },
      toolTraceJson: null,
      tokenUsage: null,
    });
    await this.messageRepository.save(userMessage);

    const toolTrace: string[] = [];
    const agent = this.buildAgent(toolTrace);
    const history = await this.getRecentMessages(session.id, 12);
    const prompt = this.buildTurnPrompt(history);

    let normalized: ConversationAgentOutput;
    try {
      const runResult = await run(agent, prompt, { maxTurns: 10 });
      normalized = this.normalizeAgentOutput(runResult.finalOutput, toolTrace);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Conversation agent execution failed: ${messageText}`);
      normalized = {
        answer:
          'I could not finalize classification from available evidence. Please provide more product details (material, function, and format).',
        recommendedHts: null,
        alternatives: [],
        confidence: 0,
        needsClarification: true,
        clarificationQuestions: [
          'What is the exact product type and end use?',
          'Is this item a periodical/publication, or a toy/electrical good?',
        ],
        evidence: [],
        toolTrace,
      };
    }

    const assistantMessage = this.messageRepository.create({
      sessionId: session.id,
      role: 'assistant',
      contentJson: normalized as Record<string, any>,
      toolTraceJson: normalized.toolTrace,
      tokenUsage: null,
    });
    const savedAssistant = await this.messageRepository.save(assistantMessage);

    session.contextJson = {
      ...(session.contextJson || {}),
      lastToolTrace: normalized.toolTrace,
      lastRecommendedHts: normalized.recommendedHts || null,
      lastConfidence: normalized.confidence,
    };
    await this.sessionRepository.save(session);

    return {
      conversationId,
      response: normalized,
      messageId: savedAssistant.id,
      toolTrace: normalized.toolTrace,
    };
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

    if (payload.messageId) {
      const message = await this.messageRepository.findOne({
        where: { id: payload.messageId, sessionId: conversationId },
      });
      if (!message) {
        throw new NotFoundException(
          `Message ${payload.messageId} not found in conversation ${conversationId}`,
        );
      }
    }

    const feedback = this.feedbackRepository.create({
      sessionId: conversationId,
      messageId: payload.messageId || null,
      isCorrect: payload.isCorrect,
      chosenHts: payload.chosenHts || null,
      comment: payload.comment || null,
      metadata: null,
    });

    const saved = await this.feedbackRepository.save(feedback);
    return {
      conversationId,
      feedbackId: saved.id,
      storedAt: saved.createdAt.toISOString(),
    };
  }

  private buildAgent(toolTrace: string[]): Agent<any, any> {
    const autocompleteTool = tool({
      name: 'hts_autocomplete',
      description:
        'Autocomplete HTS candidates using code or text query. Use for fast candidate discovery.',
      parameters: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async (input) => {
        toolTrace.push('hts_autocomplete');
        return this.searchService.autocomplete(input.query, input.limit);
      },
    });

    const hybridSearchTool = tool({
      name: 'hts_search_hybrid',
      description:
        'Run high-accuracy HTS search using lexical + semantic retrieval and ranking.',
      parameters: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(30).default(10),
      }),
      execute: async (input) => {
        toolTrace.push('hts_search_hybrid');
        return this.searchService.hybridSearch(input.query, input.limit);
      },
    });

    const exactLookupTool = tool({
      name: 'hts_lookup_exact',
      description:
        'Fetch exact HTS entry details by HTS number for evidence validation.',
      parameters: z.object({
        htsNumber: z.string(),
      }),
      execute: async (input) => {
        toolTrace.push('hts_lookup_exact');
        const row = await this.searchService.findByHtsNumber(input.htsNumber);
        if (!row) {
          return null;
        }
        return {
          htsNumber: row.htsNumber,
          chapter: row.chapter,
          description: row.description,
          fullDescription: row.fullDescription || [],
          general: row.general,
          other: row.other,
          parentHtses: row.parentHtses || [],
          sourceVersion: row.sourceVersion,
        };
      },
    });

    const compareCandidatesTool = tool({
      name: 'hts_compare_candidates',
      description:
        'Compare candidate HTS codes side-by-side for product fit and ambiguity handling.',
      parameters: z.object({
        query: z.string(),
        candidateCodes: z.array(z.string()).min(1).max(10),
      }),
      execute: async (input) => {
        toolTrace.push('hts_compare_candidates');
        const rows = await Promise.all(
          input.candidateCodes.map((code) => this.searchService.findByHtsNumber(code)),
        );
        const queryTokens = this.tokenize(input.query);
        return rows
          .filter((row): row is NonNullable<typeof row> => row !== null)
          .map((row) => {
            const description = (row.description || '').toLowerCase();
            const coverage =
              queryTokens.length === 0
                ? 0
                : queryTokens.filter((token) => description.includes(token)).length /
                  queryTokens.length;
            return {
              htsNumber: row.htsNumber,
              description: row.description || '',
              chapter: row.chapter,
              coverage,
              fullDescription: row.fullDescription || [],
            };
          });
      },
    });

    const notesTool = tool({
      name: 'hts_get_notes',
      description:
        'Resolve legal note references from HTS general/other columns for a specific HTS code.',
      parameters: z.object({
        htsNumber: z.string(),
      }),
      execute: async (input) => {
        toolTrace.push('hts_get_notes');
        const row = await this.searchService.findByHtsNumber(input.htsNumber);
        if (!row) {
          return [];
        }
        const resolvedYear = this.resolveYear(undefined, row.sourceVersion);
        const candidates: Array<{
          sourceColumn: 'general' | 'other';
          referenceText: string;
        }> = [];

        if (this.hasLikelyNoteReference(row.general)) {
          candidates.push({
            sourceColumn: 'general',
            referenceText: row.general || '',
          });
        }
        if (this.hasLikelyNoteReference(row.other)) {
          candidates.push({
            sourceColumn: 'other',
            referenceText: row.other || '',
          });
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
            notes.push({
              sourceColumn: candidate.sourceColumn,
              referenceText: candidate.referenceText,
              ...resolved,
            });
          }
        }
        return notes;
      },
    });

    return new Agent({
      name: 'HTS Advanced Conversation Agent',
      model: 'gpt-5-mini',
      instructions: `You are an expert HTS assistant for advanced users.

Goals:
1) Ask clarifying questions when product details are ambiguous.
2) Use tools to gather evidence before recommending a final HTS code.
3) Prefer specific leaf codes over generic "Other" when evidence supports it.
4) Provide alternatives when there is true ambiguity.
5) If confidence is low, set needsClarification=true and ask focused questions.

Output must follow the response schema. Use toolTrace entries from tools that were called.`,
      tools: [
        autocompleteTool,
        hybridSearchTool,
        exactLookupTool,
        compareCandidatesTool,
        notesTool,
      ],
      outputType: ConversationResponseSchema,
    });
  }

  private buildTurnPrompt(history: ConversationMessage[]): string {
    const serializedHistory = history
      .map((msg) => {
        if (msg.role === 'assistant') {
          const content =
            typeof msg.content === 'string'
              ? msg.content
              : `${msg.content.answer} (recommended=${msg.content.recommendedHts || 'n/a'}, confidence=${msg.content.confidence})`;
          return `assistant: ${content}`;
        }
        return `user: ${String(msg.content)}`;
      })
      .join('\n');

    return `Conversation context:
${serializedHistory}

Respond using the structured schema.`;
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
          'What is the exact product category and use case?',
          'Can you provide material/composition and format details?',
        ],
        evidence: [],
        toolTrace,
      };
    }

    const uniqueTrace = [...new Set([...parsed.data.toolTrace, ...toolTrace])];
    return {
      ...parsed.data,
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
    return [...new Set(((input || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((token) => token.length > 1))];
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
