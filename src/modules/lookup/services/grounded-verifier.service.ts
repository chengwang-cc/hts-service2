import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AnthropicService } from '@hts/core';
import { HtsNoteEntity } from '../../knowledgebase/entities/hts-note.entity';

export interface VerifierCandidate {
  htsNumber: string;
  description: string;
  chapter: string;
  fullDescription: string[] | null;
  /** Cross-encoder reranker score (0–1), or hand-tuned score if reranker is off */
  score: number;
}

export interface VerifierResult {
  /** Whether the verifier was invoked for this query */
  triggered: boolean;
  /** The reranker top-1 score that triggered verification (if triggered) */
  topScore: number;
  /** HTS number that the verifier chose as best match, or null if no suitable match */
  verifiedHtsNumber: string | null;
  /** Claude's stated confidence for the verified code (0–1) */
  confidence: number;
  /** Chain-of-thought reasoning from Claude */
  reasoning: string;
}

interface ClaudeVerifierOutput {
  htsNumber: string | null;
  confidence: number;
  reasoning: string;
}

/**
 * Phase 5 — Grounded Verifier
 *
 * After the DGX cross-encoder reranker scores candidates, this service invokes
 * Claude Haiku when the top-1 score is below a confidence threshold.
 *
 * Claude receives:
 *  - The search query
 *  - Top-N reranked candidates with descriptions and breadcrumbs
 *  - Relevant chapter notes from the HTS knowledge base
 *
 * It performs chain-of-thought reasoning and selects the best HTS code (or none).
 */
@Injectable()
export class GroundedVerifierService {
  private readonly logger = new Logger(GroundedVerifierService.name);

  private readonly enabled: boolean;
  private readonly threshold: number;
  private readonly model: string;
  private readonly topK: number;
  private readonly maxNoteChars: number;

  private readonly SYSTEM_PROMPT = `\
You are an HTS (Harmonized Tariff Schedule of the United States) classification expert.

Given a product query and a set of candidate HTS codes (already ranked by a cross-encoder), your task is to:
1. Reason step-by-step about what the product is and its material, use, and trade context.
2. Evaluate each candidate code and its chapter notes.
3. Select the single best HTS code for the product, or return null if none of the candidates are appropriate.

Respond with ONLY valid JSON in this exact shape:
{
  "htsNumber": "<8 or 10-digit HTS code, e.g. 8471.30.01.00>  OR null",
  "confidence": <float 0.0–1.0>,
  "reasoning": "<2–4 sentences of chain-of-thought reasoning>"
}

Rules:
- htsNumber must be one of the candidate codes provided, or null.
- confidence reflects how certain you are about your selection (1.0 = certain, 0.0 = no idea).
- reasoning should explain which product attributes led to your choice and why alternatives were rejected.
- Do not invent HTS codes not in the candidate list.`;

  constructor(
    @InjectRepository(HtsNoteEntity)
    private readonly noteRepository: Repository<HtsNoteEntity>,
    private readonly anthropic: AnthropicService,
    private readonly config: ConfigService,
  ) {
    this.enabled =
      config.get<string>('VERIFIER_ENABLED', 'false') === 'true';
    this.threshold = parseFloat(
      config.get<string>('VERIFIER_CONFIDENCE_THRESHOLD', '0.5'),
    );
    this.model = config.get<string>(
      'VERIFIER_MODEL',
      'claude-haiku-4-5-20251001',
    );
    this.topK = parseInt(config.get<string>('VERIFIER_TOP_K', '5'), 10);
    this.maxNoteChars = parseInt(
      config.get<string>('VERIFIER_MAX_NOTE_CHARS', '600'),
      10,
    );
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Decide whether to trigger the verifier based on the top candidate score.
   * Returns false (don't trigger) when:
   *  - verifier is disabled, OR
   *  - top score is already >= threshold (reranker is confident)
   */
  shouldTrigger(topScore: number): boolean {
    return this.enabled && topScore < this.threshold;
  }

  /**
   * Invoke Claude Haiku to verify the top candidates for a query.
   *
   * @param query   Original search query
   * @param candidates  Reranked candidates (sorted desc by score)
   * @returns VerifierResult
   */
  async verify(
    query: string,
    candidates: VerifierCandidate[],
  ): Promise<VerifierResult> {
    const topScore = candidates[0]?.score ?? 0;

    if (!this.shouldTrigger(topScore)) {
      return {
        triggered: false,
        topScore,
        verifiedHtsNumber: null,
        confidence: 0,
        reasoning: '',
      };
    }

    const topCandidates = candidates.slice(0, this.topK);

    // Collect unique chapters to fetch notes for
    const chapters = [...new Set(topCandidates.map((c) => c.chapter))].slice(0, 2);
    const notes = await this.fetchChapterNotes(chapters);

    const userMessage = this.buildUserMessage(query, topCandidates, notes);

    try {
      const parsed = await this.anthropic.completeJson<ClaudeVerifierOutput>(
        userMessage,
        {
          model: this.model,
          maxTokens: 512,
          system: this.SYSTEM_PROMPT,
          cacheSystem: true,
        },
      );

      // Validate that the returned htsNumber is one of our candidates
      const valid = topCandidates.some(
        (c) => c.htsNumber === parsed.htsNumber,
      );
      const verifiedHtsNumber = valid ? (parsed.htsNumber ?? null) : null;

      this.logger.log(
        `Verifier triggered (top score=${topScore.toFixed(3)}<${this.threshold}): ` +
        `verified=${verifiedHtsNumber ?? 'none'} confidence=${parsed.confidence?.toFixed(2)}`,
      );

      return {
        triggered: true,
        topScore,
        verifiedHtsNumber,
        confidence: parsed.confidence ?? 0,
        reasoning: parsed.reasoning ?? '',
      };
    } catch (err) {
      this.logger.warn(
        `Verifier failed, returning no override: ${(err as Error).message}`,
      );
      return {
        triggered: true,
        topScore,
        verifiedHtsNumber: null,
        confidence: 0,
        reasoning: '',
      };
    }
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private async fetchChapterNotes(
    chapters: string[],
  ): Promise<HtsNoteEntity[]> {
    if (chapters.length === 0) return [];
    try {
      return await this.noteRepository.find({
        where: { chapter: In(chapters) },
        select: ['chapter', 'noteType', 'noteNumber', 'title', 'content'],
        order: { chapter: 'ASC', noteNumber: 'ASC' },
        take: 6,
      });
    } catch {
      return [];
    }
  }

  private buildUserMessage(
    query: string,
    candidates: VerifierCandidate[],
    notes: HtsNoteEntity[],
  ): string {
    const candidateLines = candidates
      .map((c, i) => {
        const breadcrumb = (c.fullDescription ?? []).slice(-2).join(' › ');
        return (
          `${i + 1}. ${c.htsNumber} (reranker score: ${c.score.toFixed(3)})\n` +
          `   Description: ${c.description}\n` +
          `   Breadcrumb: ${breadcrumb}`
        );
      })
      .join('\n');

    const notesSection =
      notes.length > 0
        ? notes
            .map((n) => {
              const header = `[Chapter ${n.chapter} — ${n.noteType} ${n.noteNumber}${n.title ? ': ' + n.title : ''}]`;
              const body = (n.content ?? '').slice(0, this.maxNoteChars);
              return `${header}\n${body}`;
            })
            .join('\n\n')
        : '(No chapter notes available for these candidates.)';

    return (
      `Product query: "${query}"\n\n` +
      `Reranked candidates:\n${candidateLines}\n\n` +
      `Relevant chapter notes:\n${notesSection}\n\n` +
      `Select the best HTS code from the candidates above, or return null if none applies.`
    );
  }
}
