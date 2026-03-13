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
   * Phase 1 — Chapter identification (fast, no LLM)
   *   Run autocomplete to get top-10 candidates. Extract the top 2 chapters
   *   by frequency. Chapter accuracy is ~95%, so this is a reliable router.
   *
   * Phase 2 — Focused semantic search within identified chapters
   *   Re-run semantic search restricted to those 2 chapters (~300-500 codes).
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

    // ── Phase 1: chapter identification ────────────────────────────────────
    this.logger.log(`[SmartClassify] Phase 1: autocomplete "${q}"`);
    const phase1 = await this.searchService.autocomplete(q, 10);

    const chapterCounts = new Map<string, number>();
    for (const r of phase1) {
      const ch = (r as { chapter?: string }).chapter;
      if (ch) chapterCounts.set(ch, (chapterCounts.get(ch) ?? 0) + 1);
    }

    const topChapters = [...chapterCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([ch]) => ch);

    this.logger.log(`[SmartClassify] Phase 1 done: chapters=[${topChapters.join(', ')}]`);

    if (topChapters.length === 0) {
      return { query: q, results: [], phases: { topChapters: [], narrowedCount: 0 } };
    }

    // ── Phase 2: focused semantic search in identified chapters ────────────
    this.logger.log(`[SmartClassify] Phase 2: semantic search in [${topChapters.join(', ')}]`);
    const narrowed = await this.searchService.semanticSearchInChapters(q, topChapters, 30);
    this.logger.log(`[SmartClassify] Phase 2 done: ${narrowed.length} candidates`);

    const candidates: RerankCandidate[] =
      narrowed.length > 0
        ? narrowed.slice(0, 20)
        : (phase1.slice(0, 10) as RerankCandidate[]);

    // ── Phase 3: AI reranking ──────────────────────────────────────────────
    this.logger.log(`[SmartClassify] Phase 3: reranking ${candidates.length} candidates`);
    const reranked = await this.rerankService.rerank(q, candidates);
    this.logger.log(`[SmartClassify] Done for "${q}"`);

    return {
      query: q,
      results: reranked.slice(0, 5),
      phases: { topChapters, narrowedCount: narrowed.length },
    };
  }
}
