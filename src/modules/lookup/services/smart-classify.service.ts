import { Injectable, Logger } from '@nestjs/common';
import { SearchService } from './search.service';
import { RerankService, RerankCandidate } from './rerank.service';

export interface SmartClassifyPhases {
  topChapters: string[];
  narrowedCount: number;
}

export interface SmartClassifyResult {
  query: string;
  results: RerankCandidate[];
  phases: SmartClassifyPhases;
}

@Injectable()
export class SmartClassifyService {
  private readonly logger = new Logger(SmartClassifyService.name);

  constructor(
    private readonly searchService: SearchService,
    private readonly rerankService: RerankService,
  ) {}

  /**
   * 3-phase hierarchical classification pipeline:
   *
   * Phase 1 — Chapter identification
   *   Run the hybrid search pipeline, which can normalize long descriptive
   *   queries into HTS-friendly terminology before retrieval.
   *
   * Phase 2 — Focused semantic search within identified chapters
   *   Re-run semantic search restricted to the strongest candidate chapters.
   *   Much more discriminating than searching 17,000 codes.
   *
   * Phase 3 — AI reranking of narrowed candidates
   *   gpt-5-nano ranks the top-20 narrowed candidates with domain-aware
   *   instructions (material, species, processing state, specificity).
   */
  async classify(query: string): Promise<SmartClassifyResult> {
    const q = query.trim();
    if (!q) {
      return { query, results: [], phases: { topChapters: [], narrowedCount: 0 } };
    }

    if (this.shouldUseDirectHybridResults(q)) {
      const direct = (await this.searchService.hybridSearch(q, 5)) as RerankCandidate[];
      const topChapters = [
        ...new Set(
          (direct as Array<RerankCandidate & { chapter?: string }>)
            .map((row) => row.chapter)
            .filter((chapter): chapter is string => Boolean(chapter)),
        ),
      ].slice(0, 3);
      return {
        query: q,
        results: direct,
        phases: { topChapters, narrowedCount: direct.length },
      };
    }

    // ── Phase 1: chapter identification ────────────────────────────────────
    this.logger.log(`[SmartClassify] Phase 1: hybrid search "${q}"`);
    const phase1 = await this.searchService.hybridSearch(q, 12);

    const chapterCounts = new Map<string, number>();
    for (const r of phase1) {
      const ch = (r as { chapter?: string }).chapter;
      if (ch) chapterCounts.set(ch, (chapterCounts.get(ch) ?? 0) + 1);
    }

    const topChapters = [...chapterCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ch]) => ch);

    this.logger.log(`[SmartClassify] Phase 1 done: chapters=[${topChapters.join(', ')}]`);

    if (topChapters.length === 0) {
      return { query: q, results: [], phases: { topChapters: [], narrowedCount: 0 } };
    }

    // ── Phase 2: focused semantic search in identified chapters ────────────
    this.logger.log(`[SmartClassify] Phase 2: semantic search in [${topChapters.join(', ')}]`);
    const narrowed = await this.searchService.semanticSearchInChapters(q, topChapters, 30);
    this.logger.log(`[SmartClassify] Phase 2 done: ${narrowed.length} candidates`);

    const candidates = this.mergeCandidates(
      phase1 as RerankCandidate[],
      narrowed as RerankCandidate[],
      20,
    );

    const wordCount = q.split(/\s+/).filter(Boolean).length;
    const shouldRerank = wordCount <= 2;
    let finalResults = candidates;
    if (shouldRerank && candidates.length > 1) {
      this.logger.log(
        `[SmartClassify] Phase 3: reranking ${candidates.length} candidates`,
      );
      finalResults = await this.rerankService.rerank(q, candidates);
    }
    this.logger.log(`[SmartClassify] Done for "${q}"`);

    return {
      query: q,
      results: finalResults.slice(0, 5),
      phases: { topChapters, narrowedCount: narrowed.length },
    };
  }

  private shouldUseDirectHybridResults(query: string): boolean {
    const lower = query.toLowerCase();
    const naturalLanguageSignals =
      /\b(packaged|containing|made of|made from|prepared|roasted|ground|fresh|frozen|sample|promotional|not for resale|retail)\b/.test(
        lower,
      ) || /[.]/.test(query);

    const catalogSignals =
      /\d/.test(query) ||
      /[,/|]/.test(query) ||
      /[a-z]+\d+[a-z0-9]*/i.test(query);

    return catalogSignals && !naturalLanguageSignals;
  }

  private mergeCandidates(
    primary: RerankCandidate[],
    secondary: RerankCandidate[],
    limit: number,
  ): RerankCandidate[] {
    const merged = new Map<string, RerankCandidate>();
    for (const candidate of primary) {
      merged.set(candidate.htsNumber, candidate);
      if (merged.size >= limit) {
        return [...merged.values()];
      }
    }
    for (const candidate of secondary) {
      if (!merged.has(candidate.htsNumber)) {
        merged.set(candidate.htsNumber, candidate);
      }
      if (merged.size >= limit) {
        break;
      }
    }
    return [...merged.values()];
  }
}
