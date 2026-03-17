import { Injectable, Logger } from '@nestjs/common';
import { SearchService } from './search.service';
import { RerankService, RerankCandidate } from './rerank.service';

export interface SmartClassifyPhases {
  normalizedQuery?: string;
  topChapters: string[];
  topHeadings?: string[];
  topSubheadings?: string[];
  narrowedCount: number;
}

export interface SmartClassifyResult {
  query: string;
  results: RerankCandidate[];
  phases: SmartClassifyPhases;
}

interface RefinementDecision {
  useHierarchy: boolean;
  topChapters: string[];
  topHeadings: string[];
  topSubheadings: string[];
  narrowedCount: number;
}

@Injectable()
export class SmartClassifyService {
  private readonly logger = new Logger(SmartClassifyService.name);
  private readonly enableHierarchicalRefinement = false;

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
      return {
        query,
        results: [],
        phases: { normalizedQuery: '', topChapters: [], topHeadings: [], topSubheadings: [], narrowedCount: 0 },
      };
    }

    // ── Phase 1: normalized hybrid retrieval ───────────────────────────────
    this.logger.log(`[SmartClassify] Phase 1: normalized hybrid search "${q}"`);
    const phase1 = await this.searchService.searchWithStandardization(q, 60);
    const baseCandidates = (phase1.results || []) as Array<RerankCandidate & {
      chapter?: string;
      score?: number;
      fullDescription?: string[] | null;
    }>;
    const normalizedQuery = phase1.standardizedQuery || q;

    if (!baseCandidates.length) {
      return {
        query: q,
        results: [],
        phases: { normalizedQuery, topChapters: [], topHeadings: [], topSubheadings: [], narrowedCount: 0 },
      };
    }

    const topChapters = this.selectTopPrefixes(
      baseCandidates,
      2,
      3,
      phase1.headingHints,
      3,
    );
    this.logger.log(
      `[SmartClassify] Phase 1 done: normalized="${normalizedQuery}", chapters=[${topChapters.join(', ')}]`,
    );

    if (!topChapters.length) {
      return {
        query: q,
        results: baseCandidates.slice(0, 10),
        phases: {
          normalizedQuery,
          topChapters: [],
          topHeadings: [],
          topSubheadings: [],
          narrowedCount: baseCandidates.length,
        },
      };
    }

    const refinementDecision = this.decideRefinementStrategy(
      q,
      normalizedQuery,
      baseCandidates,
      topChapters,
      phase1.headingHints,
    );
    if (!refinementDecision.useHierarchy) {
      this.logger.log(
        `[SmartClassify] Returning direct hybrid results for "${q}" (chapters=[${refinementDecision.topChapters.join(', ')}])`,
      );
      return {
        query: q,
        results: baseCandidates.slice(0, 10),
        phases: {
          normalizedQuery,
          topChapters: refinementDecision.topChapters,
          topHeadings: refinementDecision.topHeadings,
          topSubheadings: refinementDecision.topSubheadings,
          narrowedCount: refinementDecision.narrowedCount,
        },
      };
    }

    // ── Phase 2: chapter-restricted semantic refresh ───────────────────────
    this.logger.log(
      `[SmartClassify] Phase 2: semantic search in [${topChapters.join(', ')}]`,
    );
    const semanticInChapters = await this.searchService.semanticSearchInChapters(
      normalizedQuery,
      topChapters,
      40,
    );
    const chapterPool = this.mergeCandidates(
      baseCandidates.filter((candidate) => topChapters.includes(candidate.chapter || '')),
      semanticInChapters as RerankCandidate[],
      50,
    ) as Array<RerankCandidate & {
      chapter?: string;
      score?: number;
      fullDescription?: string[] | null;
    }>;

    const topHeadings = this.selectTopPrefixes(
      chapterPool,
      4,
      4,
      phase1.headingHints,
      4,
    );
    const headingPool =
      topHeadings.length > 0
        ? chapterPool.filter((candidate) => this.compact(candidate.htsNumber).startsWith(topHeadings[0]) || topHeadings.some((heading) => this.compact(candidate.htsNumber).startsWith(heading)))
        : chapterPool;

    // ── Phase 3: subheading narrowing (6 digits) ───────────────────────────
    const topSubheadings = this.selectTopPrefixes(
      headingPool,
      6,
      5,
      [],
      2,
    );
    const narrowedPool =
      topSubheadings.length > 0
        ? headingPool.filter((candidate) =>
            topSubheadings.some((prefix) => this.compact(candidate.htsNumber).startsWith(prefix)),
          )
        : headingPool;

    const finalists = this.rankHierarchicalLeafCandidates(
      narrowedPool.length > 0 ? narrowedPool : headingPool,
      topChapters,
      topHeadings,
      topSubheadings,
      phase1.headingHints,
    ).slice(0, 8);

    const wordCount = normalizedQuery.split(/\s+/).filter(Boolean).length;
    const shouldRerank =
      finalists.length > 1 && wordCount <= 18 && !this.shouldUseDirectHybridResults(q);
    const finalResults = shouldRerank
      ? await this.rerankService.rerank(normalizedQuery, finalists)
      : finalists;

    this.logger.log(
      `[SmartClassify] Done for "${q}" → chapters=[${topChapters.join(', ')}], headings=[${topHeadings.join(', ')}], subheadings=[${topSubheadings.join(', ')}]`,
    );

    return {
      query: q,
      results: finalResults.slice(0, 10),
      phases: {
        normalizedQuery,
        topChapters,
        topHeadings,
        topSubheadings,
        narrowedCount: narrowedPool.length || headingPool.length,
      },
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

  private selectTopPrefixes(
    candidates: Array<RerankCandidate & { chapter?: string; score?: number }>,
    prefixLength: number,
    limit: number,
    headingHints: string[] = [],
    headingHintLength: number = prefixLength,
  ): string[] {
    const scores = new Map<string, number>();
    const hintedPrefixes = new Set<string>();
    candidates.forEach((candidate, index) => {
      const compact = this.compact(candidate.htsNumber);
      const prefix = compact.slice(0, prefixLength);
      if (prefix.length !== prefixLength) {
        return;
      }
      const rankWeight = 1 / (index + 1);
      const baseScore = (candidate.score ?? 0.2) + rankWeight * 0.18;
      scores.set(prefix, (scores.get(prefix) || 0) + baseScore);
    });

    for (const hint of headingHints) {
      const compactHint = this.compact(hint).slice(0, headingHintLength);
      if (compactHint.length !== headingHintLength) {
        continue;
      }
      if (prefixLength === 2) {
        const chapterPrefix = compactHint.slice(0, 2);
        hintedPrefixes.add(chapterPrefix);
        scores.set(chapterPrefix, (scores.get(chapterPrefix) || 0) + 2.2);
      } else if (prefixLength === 4 && headingHintLength === 4) {
        hintedPrefixes.add(compactHint);
        scores.set(compactHint, (scores.get(compactHint) || 0) + 2.0);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => {
        const aHinted = hintedPrefixes.has(a[0]) ? 1 : 0;
        const bHinted = hintedPrefixes.has(b[0]) ? 1 : 0;
        if (bHinted !== aHinted) {
          return bHinted - aHinted;
        }
        return b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1];
      })
      .slice(0, limit)
      .map(([prefix]) => prefix);
  }

  private rankHierarchicalLeafCandidates(
    candidates: Array<RerankCandidate & { chapter?: string; score?: number }>,
    topChapters: string[],
    topHeadings: string[],
    topSubheadings: string[],
    headingHints: string[],
  ): RerankCandidate[] {
    return [...candidates]
      .map((candidate, index) => {
        const compact = this.compact(candidate.htsNumber);
        let score = candidate.score ?? 0;
        if (topChapters.length > 0 && candidate.chapter === topChapters[0]) {
          score += 0.18;
        } else if (candidate.chapter && topChapters.includes(candidate.chapter)) {
          score += 0.08;
        }
        if (topHeadings.some((heading, i) => compact.startsWith(heading))) {
          const headingIndex = topHeadings.findIndex((heading) => compact.startsWith(heading));
          score += headingIndex === 0 ? 0.24 : 0.12;
        }
        if (topSubheadings.some((prefix) => compact.startsWith(prefix))) {
          const subheadingIndex = topSubheadings.findIndex((prefix) => compact.startsWith(prefix));
          score += subheadingIndex === 0 ? 0.22 : 0.1;
        }
        if (headingHints.some((hint) => compact.startsWith(this.compact(hint).slice(0, 4)))) {
          score += 0.16;
        }
        if (compact.length >= 10) {
          score += 0.08;
        }
        score += 1 / (index + 1) * 0.04;
        return {
          ...candidate,
          score,
        };
      })
      .sort((a, b) =>
        (b.score ?? 0) === (a.score ?? 0)
          ? a.htsNumber.localeCompare(b.htsNumber)
          : (b.score ?? 0) - (a.score ?? 0),
      );
  }

  private compact(htsNumber: string): string {
    return String(htsNumber || '').replace(/\D/g, '');
  }

  private decideRefinementStrategy(
    query: string,
    normalizedQuery: string,
    candidates: Array<RerankCandidate & { chapter?: string; score?: number }>,
    topChapters: string[],
    headingHints: string[],
  ): RefinementDecision {
    const directPhases: RefinementDecision = {
      useHierarchy: false,
      topChapters,
      topHeadings: this.selectTopPrefixes(candidates, 4, 4, headingHints, 4),
      topSubheadings: this.selectTopPrefixes(candidates, 6, 5, [], 2),
      narrowedCount: candidates.length,
    };

    if (!candidates.length) {
      return directPhases;
    }

    if (!this.enableHierarchicalRefinement) {
      return directPhases;
    }

    const topWindow = candidates.slice(0, Math.min(6, candidates.length));
    const topScore = topWindow[0]?.score ?? 0;
    const secondScore = topWindow[1]?.score ?? 0;
    const topGap = topScore - secondScore;
    const wordCount = normalizedQuery.split(/\s+/).filter(Boolean).length;
    const hinted = headingHints.length > 0;
    const catalogLike = this.shouldUseDirectHybridResults(query);
    const naturalLanguage =
      /\b(packaged|containing|made of|made from|prepared|roasted|ground|fresh|frozen|retail|jar|bottle|sample|gift|decor)\b/i.test(
        normalizedQuery,
      ) || wordCount >= 7;

    const chapterCounts = new Map<string, number>();
    for (const candidate of topWindow) {
      const chapter = candidate.chapter || this.compact(candidate.htsNumber).slice(0, 2);
      if (!chapter) {
        continue;
      }
      chapterCounts.set(chapter, (chapterCounts.get(chapter) || 0) + 1);
    }
    const dominantChapterCount = Math.max(0, ...chapterCounts.values());
    const chapterConcentration = topWindow.length > 0 ? dominantChapterCount / topWindow.length : 0;

    if (topGap >= 0.24) {
      return directPhases;
    }

    if (naturalLanguage && !hinted) {
      return directPhases;
    }

    if (!catalogLike && !hinted && chapterConcentration < 0.5) {
      return directPhases;
    }

    const shortStructuredQuery = wordCount <= 5 && !naturalLanguage;
    const strongHintedPath = hinted && chapterConcentration >= 0.5;
    const strongCatalogPath = catalogLike && shortStructuredQuery && chapterConcentration >= 0.67 && topGap < 0.18;

    if (strongHintedPath || strongCatalogPath) {
      return {
        ...directPhases,
        useHierarchy: true,
      };
    }

    return directPhases;
  }
}
