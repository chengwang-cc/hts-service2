import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '@hts/core';
import { AnthropicService } from '../../../core/services/anthropic.service';
import { QueueService } from '../../queue/queue.service';
import { LookupDebugSessionEntity, DebugIteration } from '../entities/lookup-debug-session.entity';
import { LookupTestSampleEntity } from '../entities/lookup-test-sample.entity';
import { IntentRuleService } from './intent-rule.service';
import { IntentRule } from './intent-rules';
import { SearchService } from './search.service';

export const INTENT_RULE_DEBUG_QUEUE = 'intent-rule-debug-session';

const MAX_ITERATIONS = 5;
const RESOLVED_THRESHOLD = 3;

@Injectable()
export class IntentRuleDebugService {
  private readonly logger = new Logger(IntentRuleDebugService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepo: Repository<HtsEntity>,
    @InjectRepository(LookupDebugSessionEntity)
    private readonly sessionRepo: Repository<LookupDebugSessionEntity>,
    @InjectRepository(LookupTestSampleEntity)
    private readonly sampleRepo: Repository<LookupTestSampleEntity>,
    private readonly searchService: SearchService,
    private readonly intentRuleService: IntentRuleService,
    private readonly anthropicService: AnthropicService,
    private readonly queueService: QueueService,
  ) {}

  /** Create a debug session and enqueue the AI loop job. */
  async startSession(query: string, expectedHtsNumber: string): Promise<{ sessionId: string }> {
    const session = this.sessionRepo.create({
      query,
      expectedHtsNumber,
      status: 'pending',
      iterations: [],
      rulesAdded: null,
      resolvedAtRank: null,
    });
    const saved = await this.sessionRepo.save(session);

    await this.queueService.sendJob(
      INTENT_RULE_DEBUG_QUEUE,
      { sessionId: saved.id },
      {
        retryLimit: 1,
        retryDelay: 10,
      },
    );

    this.logger.log(`Debug session started: ${saved.id} | query="${query}" expected=${expectedHtsNumber}`);
    return { sessionId: saved.id };
  }

  /** AI debug loop — runs inside pg-boss. */
  async processSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) {
      this.logger.error(`Debug session not found: ${sessionId}`);
      return;
    }

    // Load expected HTS entry for context
    const expectedEntry = await this.htsRepo.findOne({
      where: { htsNumber: session.expectedHtsNumber, isActive: true },
      select: { htsNumber: true, description: true, fullDescription: true, chapter: true },
    });

    session.status = 'running';
    await this.sessionRepo.save(session);

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // 1. Run search
      const results = await this.searchService.hybridSearch(session.query, 20);

      // 2. Find expected rank (exact match, or 8-digit prefix match)
      const normalizedExpected = session.expectedHtsNumber.replace(/\./g, '');
      const expectedIndex = results.findIndex((r) => {
        const normalized = r.htsNumber.replace(/\./g, '');
        return normalized === normalizedExpected || normalized.startsWith(normalizedExpected.slice(0, 8));
      });
      const expectedRank = expectedIndex >= 0 ? expectedIndex + 1 : null;

      const topResults = results.slice(0, 10).map((r, idx) => ({
        htsNumber: r.htsNumber as string,
        rank: idx + 1,
        description: r.description as string,
      }));

      this.logger.log(
        `Session ${sessionId} iteration ${i + 1}: expected rank=${expectedRank ?? 'not found'}`,
      );

      // 3. Check if resolved
      if (expectedRank !== null && expectedRank <= RESOLVED_THRESHOLD) {
        const iteration: DebugIteration = {
          iterationNumber: i + 1,
          topResults: topResults.map(({ htsNumber, rank }) => ({ htsNumber, rank })),
          expectedRank,
          diagnosis: `Resolved — expected entry found at rank ${expectedRank}`,
          ruleApplied: null,
        };
        session.iterations = [...session.iterations, iteration];
        session.status = 'resolved';
        session.resolvedAtRank = expectedRank;
        await this.sessionRepo.save(session);

        // Save test sample
        await this.sampleRepo.save(
          this.sampleRepo.create({
            htsNumber: session.expectedHtsNumber,
            query: session.query,
            source: 'debug-session',
          }),
        );
        this.logger.log(`Session ${sessionId} resolved at rank ${expectedRank}`);
        return;
      }

      // 4. Build prompt and call Claude
      const existingMatchedRules = this.intentRuleService.matchRules(
        new Set(session.query.toLowerCase().match(/[a-z0-9]+/g) ?? []),
      );
      const prompt = this.buildDebugPrompt(
        session.query,
        session.expectedHtsNumber,
        expectedEntry,
        topResults,
        existingMatchedRules,
        expectedRank,
        i + 1,
      );

      let diagnosis = '';
      let rule: IntentRule | null = null;

      try {
        const response = await this.anthropicService.completeJson<{ diagnosis: string; rule: IntentRule | null }>(
          prompt,
          { model: 'claude-sonnet-4-6', maxTokens: 4096 },
        );
        diagnosis = response?.diagnosis ?? '';
        rule = response?.rule ?? null;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Session ${sessionId} iteration ${i + 1}: Claude error: ${msg}`);
        diagnosis = `Claude error: ${msg}`;
        rule = null;
      }

      // 5. Apply rule if provided
      if (rule) {
        if (!rule.id.startsWith('AI_DEBUG_') && !rule.id.startsWith('AI_')) {
          rule.id = `AI_DEBUG_${rule.id}`;
        } else if (!rule.id.startsWith('AI_DEBUG_') && rule.id.startsWith('AI_')) {
          rule.id = `AI_DEBUG_${rule.id.slice(3)}`;
        }
        if (rule.id.length > 90) {
          rule.id = rule.id.slice(0, 90);
        }
        try {
          await this.intentRuleService.upsertRule(rule, 500);
          session.rulesAdded = [...(session.rulesAdded ?? []), rule.id];
          this.logger.log(`Session ${sessionId} iteration ${i + 1}: applied rule ${rule.id}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Session ${sessionId}: failed to upsert rule: ${msg}`);
          rule = null;
        }
      }

      // 6. Save iteration
      const iteration: DebugIteration = {
        iterationNumber: i + 1,
        topResults: topResults.map(({ htsNumber, rank }) => ({ htsNumber, rank })),
        expectedRank,
        diagnosis,
        ruleApplied: rule,
      };
      session.iterations = [...session.iterations, iteration];
      await this.sessionRepo.save(session);

      if (!rule) {
        // Claude couldn't suggest a fix
        session.status = 'failed';
        await this.sessionRepo.save(session);
        this.logger.log(`Session ${sessionId} failed — no rule suggested at iteration ${i + 1}`);
        return;
      }
    }

    // Max iterations reached without resolving
    session.status = 'max-iterations';
    await this.sessionRepo.save(session);
    this.logger.log(`Session ${sessionId} reached max iterations (${MAX_ITERATIONS})`);
  }

  private buildDebugPrompt(
    query: string,
    expectedHtsNumber: string,
    expectedEntry: HtsEntity | null,
    topResults: { htsNumber: string; rank: number; description: string }[],
    existingRules: IntentRule[],
    expectedRank: number | null,
    iterationNumber: number,
  ): string {
    const description = expectedEntry?.description ?? 'Unknown';
    const path = expectedEntry?.fullDescription
      ? expectedEntry.fullDescription.slice(-3).join(' > ')
      : description;
    const rankStr = expectedRank !== null ? `rank ${expectedRank}` : 'not found in top 20';

    return `You are an HTS search ranking expert. Iteration ${iterationNumber}/${MAX_ITERATIONS}.

QUERY: "${query}"
EXPECTED TOP-${RESOLVED_THRESHOLD} ENTRY: ${expectedHtsNumber} — ${description}
CATEGORY PATH: ${path}
CURRENT RANK: ${rankStr}

TOP 10 SEARCH RESULTS:
${JSON.stringify(topResults.slice(0, 10))}

EXISTING INTENT RULES MATCHING THIS QUERY (${existingRules.length} rules):
${JSON.stringify(existingRules)}

TASK:
1. Diagnose WHY the expected entry is not ranking in top ${RESOLVED_THRESHOLD}.
2. Generate ONE IntentRule to fix this:
   - id format: "AI_DEBUG_{SHORTNAME}" (UPPERCASE_SNAKE_CASE)
   - Prefer inject[].prefix (syntheticRank: 40) to guarantee candidate inclusion
   - Use whitelist.denyChapters or penalties to suppress strong wrong competitors
   - pattern tokens: single lowercase words only
3. Return rule: null ONLY if you are certain intent rules cannot fix this.

IntentRule schema (TypeScript):
interface TokenPattern { required?: string[]; anyOf?: string[]; noneOf?: string[]; }
interface InjectSpec { prefix: string; syntheticRank?: number; }
interface ScoreAdjustment { delta: number; prefixMatch?: string; chapterMatch?: string; entryMustHaveAnyToken?: string[]; }
interface IntentRule { id: string; description: string; pattern: TokenPattern; inject?: InjectSpec[]; whitelist?: { allowChapters?: string[]; denyChapters?: string[]; allowPrefixes?: string[]; denyPrefixes?: string[] }; boosts?: ScoreAdjustment[]; penalties?: ScoreAdjustment[]; }

RETURN JSON ONLY: { "diagnosis": "<string>", "rule": <IntentRule | null> }`;
  }

  /** List recent debug sessions. */
  async listSessions(
    page: number,
    pageSize: number,
  ): Promise<{ data: LookupDebugSessionEntity[]; total: number }> {
    const [data, total] = await this.sessionRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { data, total };
  }

  /** Get a single debug session by ID. */
  async getSession(id: string): Promise<LookupDebugSessionEntity> {
    const session = await this.sessionRepo.findOne({ where: { id } });
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    return session;
  }
}
