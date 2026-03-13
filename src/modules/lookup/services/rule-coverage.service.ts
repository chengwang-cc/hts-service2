import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Like, Repository } from 'typeorm';
import { HtsEntity } from '@hts/core';
import { AnthropicService } from '../../../core/services/anthropic.service';
import { QueueService } from '../../queue/queue.service';
import { LookupIntentRuleEntity } from '../entities/lookup-intent-rule.entity';
import { IntentRuleService } from './intent-rule.service';
import { IntentRule } from './intent-rules';

export const INTENT_COVERAGE_CHAPTER_QUEUE = 'intent-coverage-chapter';

/** Max entries per Claude call. Large chapters (ch.84 ~700 entries) exceed token limits
 *  and request timeouts when sent in one shot. Chunking keeps each prompt manageable. */
const CHAPTER_CHUNK_SIZE = 80;
/** Delay between consecutive chunks to stay under the 30k tokens/min rate limit. */
const CHUNK_DELAY_MS = 3000;

const COVERAGE_SYSTEM_PROMPT = `You are an expert in HTS (Harmonized Tariff Schedule) product classification and consumer search behavior.

TASK: Identify gaps in our HTS product search system's intent rule coverage.

BACKGROUND:
Our search system lets importers type consumer-language queries (e.g. "phone case", "yoga mat") to find the correct HTS classification. We use "intent rules" that boost/inject specific HTS entries when matching query tokens appear. Semantic embedding search already handles straightforward vocabulary matches; intent rules are only needed when consumer terms are very different from HTS legal descriptions (e.g. "phone case" vs. "articles of plastics") or when multiple chapters compete for the same query.

IntentRule schema (TypeScript):
interface TokenPattern {
  required?: string[];      // ALL tokens must be present (single words, lowercase)
  anyOf?: string[];         // AT LEAST ONE token must be present
  anyOfGroups?: string[][]; // Each inner array: at least one match required (compound anyOf)
  noneOf?: string[];        // NONE of these tokens may be present
}
interface InjectSpec {
  prefix: string;           // HTS prefix, e.g. "3926.90"
  syntheticRank?: number;   // Synthetic rank position, default 40
}
interface WhitelistSpec {
  allowPrefixes?: string[];
  denyPrefixes?: string[];
  allowChapters?: string[];
  denyChapters?: string[];
}
interface ScoreAdjustment {
  delta: number;            // POSITIVE number (engine handles sign)
  prefixMatch?: string;     // Apply if entry.htsNumber starts with this
  chapterMatch?: string;    // Apply if entry.chapter === this
  entryMustHaveAnyToken?: string[];
  entryMustNotHaveAnyToken?: string[];
}
interface IntentRule {
  id: string;
  description: string;
  pattern: TokenPattern;
  lexicalFilter?: { stripTokens?: string[] };
  inject?: InjectSpec[];
  whitelist?: WhitelistSpec;
  boosts?: ScoreAdjustment[];
  penalties?: ScoreAdjustment[];
}

RULES FOR GENERATING IntentRules:
- id: format "AI_CH{chapter}_{SHORTNAME}" using UPPERCASE_SNAKE_CASE (e.g. "AI_CH39_OUTDOOR_FURNITURE")
- pattern tokens: ONLY single lowercase words — the tokenizer splits on [a-z0-9]+ boundaries
- inject[].syntheticRank: always 40 (default)
- boosts[].delta / penalties[].delta: positive numbers in range 0.3–0.6
- Prefer ONE broad rule per product family over many narrow per-entry rules
- Generate inject specs for HTS prefixes that are hard to find via semantic search
- Return [] if all entries in this chapter are adequately handled by existing rules or by semantic search

RETURN: A raw JSON array of IntentRule objects ONLY. No markdown fences. No explanation text.`;

@Injectable()
export class RuleCoverageService {
  private readonly logger = new Logger(RuleCoverageService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepo: Repository<HtsEntity>,
    @InjectRepository(LookupIntentRuleEntity)
    private readonly ruleRepo: Repository<LookupIntentRuleEntity>,
    private readonly intentRuleService: IntentRuleService,
    private readonly anthropicService: AnthropicService,
    private readonly queueService: QueueService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Coordinator: load all distinct chapters and enqueue one analysis job per chapter.
   * Returns the list of chapters queued.
   */
  async startCoverageScan(): Promise<string[]> {
    const rows = await this.htsRepo
      .createQueryBuilder('hts')
      .select('DISTINCT hts.chapter', 'chapter')
      .where('hts.isActive = :active', { active: true })
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .orderBy('hts.chapter', 'ASC')
      .getRawMany<{ chapter: string }>();

    const chapters = rows.map((r) => r.chapter);

    for (const chapter of chapters) {
      await this.queueService.sendJob(
        INTENT_COVERAGE_CHAPTER_QUEUE,
        { chapter },
        {
          singletonKey: `coverage-chapter-${chapter}`,
          retryLimit: 3,
          retryDelay: 30,
          retryBackoff: true,
        },
      );
    }

    this.logger.log(`Coverage scan started: ${chapters.length} chapters queued`);
    return chapters;
  }

  /**
   * Job handler: analyze one chapter, generate new rules for uncovered product types,
   * and upsert them into the DB.
   *
   * Large chapters (e.g. ch.84 with 700+ entries) are split into CHAPTER_CHUNK_SIZE
   * batches so each Claude call stays within token limits and request timeouts.
   * Rules are deduplicated by ID across chunks before upserting.
   */
  async processChapter(chapter: string): Promise<void> {
    this.logger.log(`Processing coverage for chapter ${chapter}`);

    // Load leaf entries for this chapter
    const entries = await this.htsRepo.find({
      where: { chapter, isActive: true, hasChildren: false },
      select: {
        htsNumber: true,
        description: true,
        fullDescription: true,
      },
    });

    if (entries.length === 0) {
      this.logger.log(`Chapter ${chapter}: no leaf entries, skipping`);
      return;
    }

    // Filter existing rules relevant to this chapter
    const chapterRules = this.intentRuleService.getAllRules().filter((rule) => {
      if (rule.inject?.some((i) => i.prefix.startsWith(chapter))) return true;
      if (rule.whitelist?.allowChapters?.includes(chapter)) return true;
      if (rule.whitelist?.allowPrefixes?.some((p) => p.startsWith(chapter))) return true;
      if (rule.boosts?.some((b) => b.chapterMatch === chapter)) return true;
      if (rule.penalties?.some((p) => p.chapterMatch === chapter)) return true;
      return false;
    });

    // Compact entry representation for the prompt
    const compactEntries = entries.map((e) => ({
      htsNumber: e.htsNumber,
      description: e.description,
      path: (e.fullDescription ?? []).slice(-3).join(' > '),
    }));

    // Split into chunks to avoid token limits and request timeouts
    const chunks: (typeof compactEntries)[] = [];
    for (let i = 0; i < compactEntries.length; i += CHAPTER_CHUNK_SIZE) {
      chunks.push(compactEntries.slice(i, i + CHAPTER_CHUNK_SIZE));
    }

    this.logger.log(
      `Chapter ${chapter}: ${compactEntries.length} entries → ${chunks.length} chunk(s)`,
    );

    const allGenerated: IntentRule[] = [];

    for (const [chunkIdx, chunk] of chunks.entries()) {
      if (chunkIdx > 0) {
        // Brief pause between chunks to stay under the rate limit
        await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
      }

      const batchLabel =
        chunks.length > 1 ? ` (batch ${chunkIdx + 1}/${chunks.length})` : '';

      const userMessage = `CHAPTER ${chapter}${batchLabel} — EXISTING COVERAGE RULES (${chapterRules.length}):
${JSON.stringify(chapterRules)}

CHAPTER ${chapter}${batchLabel} — LEAF HTS ENTRIES (${chunk.length} of ${compactEntries.length}):
${JSON.stringify(chunk)}

Which product types in this batch are NOT covered by the existing rules and would be hard to find via semantic search alone? Generate new IntentRules for them. Return [] if no gaps.`;

      let generated: IntentRule[];
      try {
        generated = await this.anthropicService.completeJson<IntentRule[]>(userMessage, {
          model: 'claude-sonnet-4-6',
          maxTokens: 4096,
          system: COVERAGE_SYSTEM_PROMPT,
          cacheSystem: true,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('JSON') || msg.includes('parse') || msg.includes('Unexpected')) {
          this.logger.error(
            `Chapter ${chapter} batch ${chunkIdx + 1}: Claude returned invalid JSON, skipping. Error: ${msg}`,
          );
          continue; // Skip this batch but process remaining chunks
        }
        throw err; // Transient errors — pg-boss will retry the whole job
      }

      if (!Array.isArray(generated)) {
        this.logger.warn(`Chapter ${chapter} batch ${chunkIdx + 1}: Claude returned non-array, skipping batch`);
        continue;
      }

      allGenerated.push(...generated);
      this.logger.log(
        `Chapter ${chapter} batch ${chunkIdx + 1}/${chunks.length}: ${generated.length} rules generated`,
      );
    }

    if (allGenerated.length === 0) {
      this.logger.log(`Chapter ${chapter}: fully covered, no new rules needed`);
      return;
    }

    // Deduplicate by rule ID (later batches may refine earlier ones; last wins)
    const dedupedById = new Map<string, IntentRule>();
    for (const rule of allGenerated) {
      dedupedById.set(rule.id, rule);
    }

    let upserted = 0;
    for (const rule of dedupedById.values()) {
      if (!rule.id || typeof rule.id !== 'string' || !rule.description || !rule.pattern) {
        this.logger.warn(`Chapter ${chapter}: skipping malformed rule: ${JSON.stringify(rule).slice(0, 200)}`);
        continue;
      }
      // Ensure ID follows the AI_ convention
      if (!rule.id.startsWith('AI_')) {
        rule.id = `AI_${rule.id}`;
      }
      // Guard against DB column length limit (ruleId varchar 100)
      if (rule.id.length > 90) {
        rule.id = rule.id.slice(0, 90);
        this.logger.warn(`Chapter ${chapter}: rule ID truncated to 90 chars: ${rule.id}`);
      }
      try {
        await this.intentRuleService.upsertRule(rule, 1000, true);
        upserted++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Chapter ${chapter}: failed to upsert rule ${rule.id}: ${msg}`);
      }
    }

    if (upserted > 0) {
      await this.intentRuleService.reload();
      this.logger.log(`Chapter ${chapter}: upserted ${upserted} new rules`);
    }
  }

  /**
   * Re-queue only chapters whose pg-boss jobs are in a failed state.
   * Unlike startCoverageScan(), this does NOT use singletonKey so the new
   * jobs always get inserted regardless of prior job history.
   */
  async retryFailedChapters(): Promise<string[]> {
    const rows = await this.dataSource.query<{ chapter: string }[]>(
      `SELECT DISTINCT data->>'chapter' AS chapter
       FROM pgboss.job
       WHERE name = $1 AND state = 'failed'
       ORDER BY chapter`,
      [INTENT_COVERAGE_CHAPTER_QUEUE],
    );

    const chapters = rows.map((r) => r.chapter).filter(Boolean);

    for (const chapter of chapters) {
      await this.queueService.sendJob(
        INTENT_COVERAGE_CHAPTER_QUEUE,
        { chapter },
        {
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
        },
      );
    }

    this.logger.log(`Retried ${chapters.length} failed chapter jobs`);
    return chapters;
  }

  /** Status summary for the coverage scan — queries DB directly for consistency across pods. */
  async getStatus(): Promise<{
    totalRules: number;
    aiRules: number;
    handcraftedRules: number;
    chapterJobStats: { completed: number; failed: number; pending: number };
  }> {
    const [totalRules, aiRules, jobStats] = await Promise.all([
      this.ruleRepo.count({ where: { enabled: true } }),
      this.ruleRepo.count({ where: { enabled: true, ruleId: Like('AI_%') } }),
      this.dataSource.query<{ state: string; count: string }[]>(
        `SELECT state, COUNT(*) AS count FROM pgboss.job WHERE name = $1 GROUP BY state`,
        [INTENT_COVERAGE_CHAPTER_QUEUE],
      ),
    ]);

    const byState = Object.fromEntries(
      jobStats.map((r) => [r.state, parseInt(r.count, 10)]),
    );

    return {
      totalRules,
      aiRules,
      handcraftedRules: totalRules - aiRules,
      chapterJobStats: {
        completed: byState['completed'] ?? 0,
        failed: byState['failed'] ?? 0,
        pending: (byState['created'] ?? 0) + (byState['active'] ?? 0),
      },
    };
  }
}
