import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { HtsEntity, EmbeddingService } from '@hts/core';

type QueryIntent = 'code' | 'text' | 'mixed';

interface SemanticCandidate {
  htsNumber: string;
  similarity: number;
}

interface KeywordCandidate {
  htsNumber: string;
  score: number;
}

interface CandidateEntry {
  htsNumber: string;
  description: string;
  chapter: string;
  indent: number;
  fullDescription?: string[] | null;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly MAX_LIMIT = 100;
  private readonly RRF_K = 50;
  private readonly GENERIC_LABELS = new Set([
    'other',
    'other:',
    'other.',
    'nesoi',
    'n.e.s.o.i.',
    'n.e.s.i.',
    'not elsewhere specified',
  ]);

  private readonly QUERY_SYNONYMS: Record<string, string[]> = {
    comic: ['comics', 'manga', 'graphic', 'periodical'],
    comics: ['comic', 'manga', 'graphic', 'periodical'],
    manga: ['comic', 'comics', 'graphic', 'periodical'],
    periodical: ['journal', 'magazine', 'serial'],
    journal: ['periodical', 'magazine'],
    magazine: ['periodical', 'journal'],
    transformer: ['transformers', 'toy'],
  };

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async hybridSearch(query: string, limit: number = 20): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 20);
    if (!normalizedQuery) {
      return [];
    }

    const queryTokens = this.tokenizeQuery(normalizedQuery);
    const expandedTokens = this.expandQueryTokens(queryTokens);
    let semanticResults: SemanticCandidate[] = [];
    const shouldRunSemantic =
      queryTokens.length > 0 &&
      normalizedQuery.length >= 4 &&
      !this.isLikelyHtsCodeQuery(normalizedQuery);

    if (shouldRunSemantic) {
      try {
        semanticResults = await this.semanticTextSearch(
          normalizedQuery,
          Math.min(this.MAX_LIMIT, safeLimit * 4),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Semantic search unavailable, falling back to keyword-only search: ${message}`,
        );
      }
    }

    const keywordResults = await this.searchByKeyword(
      normalizedQuery,
      Math.min(this.MAX_LIMIT, safeLimit * 4),
      expandedTokens,
    );
    const combined = this.combineResults(
      semanticResults,
      keywordResults,
      Math.min(this.MAX_LIMIT, safeLimit * 4),
    );
    if (combined.length === 0) {
      return [];
    }

    const htsNumbers = combined.map((result) => result.htsNumber);
    const entries = await this.htsRepository.find({
      where: {
        htsNumber: In(htsNumbers),
        isActive: true,
      },
      select: ['htsNumber', 'description', 'chapter', 'indent', 'fullDescription'],
    });
    const entryByHts = new Map(
      entries.map((entry) => [entry.htsNumber, entry]),
    );

    const reranked = combined
      .map((result) => {
        const entry = entryByHts.get(result.htsNumber);
        if (!entry) {
          return null;
        }

        const coverage = this.computeCoverageScore(
          expandedTokens,
          this.buildEntryText(entry),
        );
        const phraseBoost = this.computePhraseBoost(
          normalizedQuery,
          this.buildEntryText(entry),
        );
        const specificityBoost = this.computeSpecificityBoost(entry.htsNumber);
        const genericPenalty = this.computeGenericPenalty(
          entry.description,
          coverage,
        );

        const score =
          result.score +
          coverage * 0.7 +
          phraseBoost +
          specificityBoost -
          genericPenalty;

        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: entry.indent,
          score,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      );

    const finalRows = this.applyChapterDiversity(
      reranked,
      safeLimit,
      expandedTokens.length >= 3,
    );

    return finalRows.slice(0, safeLimit);
  }

  async autocomplete(query: string, limit: number = 10): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 10);
    if (normalizedQuery.length < 2) {
      return [];
    }

    const intent = this.classifyQueryIntent(normalizedQuery);
    if (intent === 'code') {
      // Use pattern matching for HTS code queries
      return this.autocompleteByCode(normalizedQuery, safeLimit);
    }

    return this.autocompleteByTextHybrid(
      normalizedQuery,
      safeLimit,
      intent === 'mixed',
    );
  }

  /**
   * Autocomplete by HTS code pattern matching
   */
  private async autocompleteByCode(
    query: string,
    limit: number,
  ): Promise<any[]> {
    const normalizedCode = query.replace(/[^\d]/g, '');
    const containsQuery = `%${query}%`;
    const prefixQuery = `${query}%`;
    const normalizedPrefix = `${normalizedCode}%`;
    const normalizedContains = `%${normalizedCode}%`;

    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('hts.description', 'description')
      .addSelect('hts.chapter', 'chapter')
      .addSelect('hts.indent', 'indent')
      .addSelect(
        `CASE
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') = :normalizedCode THEN 1.0
          WHEN hts.htsNumber ILIKE :prefixQuery THEN 0.96
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedPrefix THEN 0.94
          WHEN hts.htsNumber ILIKE :containsQuery THEN 0.5
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains THEN 0.45
          ELSE 0
        END`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
      .andWhere("hts.chapter NOT IN ('98', '99')")

      .andWhere(
        new Brackets((qb) => {
          qb.where('hts.htsNumber ILIKE :containsQuery', { containsQuery });
          if (normalizedCode) {
            qb.orWhere(
              "REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains",
              {
                normalizedContains,
              },
            );
          }
        }),
      )
      .setParameters({
        normalizedCode,
        prefixQuery,
        normalizedPrefix,
        containsQuery,
        normalizedContains,
      })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      htsNumber: row.htsNumber,
      description: row.description,
      chapter: row.chapter,
      indent: Number(row.indent) || 0,
      score: Number(row.score) || 0,
    }));
  }

  private async autocompleteByTextHybrid(
    query: string,
    limit: number,
    includeCodeCandidates: boolean,
  ): Promise<any[]> {
    const baseTokens = this.tokenizeQuery(query);
    const expandedTokens = this.expandQueryTokens(baseTokens);
    const candidateLimit = Math.min(this.MAX_LIMIT, Math.max(limit * 5, 30));

    const lexicalPromise = this.autocompleteByFullText(
      query,
      candidateLimit,
      expandedTokens,
    );
    const semanticPromise =
      query.length >= 4
        ? this.semanticAutocompleteSearch(query, candidateLimit)
        : Promise.resolve([] as SemanticCandidate[]);
    const codePromise = includeCodeCandidates
      ? this.autocompleteByCode(query, Math.min(candidateLimit, 20))
      : Promise.resolve([] as any[]);

    const [lexicalRows, semanticRows, codeRows] = await Promise.all([
      lexicalPromise,
      semanticPromise,
      codePromise,
    ]);

    const fused = new Map<string, number>();
    lexicalRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });
    semanticRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });
    codeRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });

    if (fused.size === 0) {
      return [];
    }

    const htsNumbers = [...fused.keys()];
    const entries = await this.htsRepository.find({
      where: { htsNumber: In(htsNumbers), isActive: true },
      select: ['htsNumber', 'description', 'chapter', 'indent', 'fullDescription'],
    });
    const entryByHts = new Map(entries.map((entry) => [entry.htsNumber, entry]));

    const ranked = htsNumbers
      .map((htsNumber) => {
        const entry = entryByHts.get(htsNumber);
        if (!entry) {
          return null;
        }
        const base = fused.get(htsNumber) || 0;
        const text = this.buildEntryText(entry);
        const coverage = this.computeCoverageScore(expandedTokens, text);
        const phraseBoost = this.computePhraseBoost(query, text);
        const specificityBoost = this.computeSpecificityBoost(htsNumber);
        const genericPenalty = this.computeGenericPenalty(
          entry.description,
          coverage,
        );

        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: Number(entry.indent) || 0,
          score:
            base +
            coverage * 0.85 +
            phraseBoost +
            specificityBoost -
            genericPenalty,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      );

    const diversified = this.applyChapterDiversity(
      ranked,
      limit,
      expandedTokens.length >= 3,
    );

    return diversified.slice(0, limit);
  }

  /**
   * Autocomplete by full-text search.
   * Strategy:
   *  1. Try AND of all words (most precise).
   *  2. Fallback: OR of all words — ts_rank scores by how many words match,
   *     so "comic books" entries outrank "transformer"-only entries.
   *     This avoids the progressive-drop pitfall where "transformer comic books"
   *     degenerates to just "books" or "transformer" alone.
   */
  private async autocompleteByFullText(
    query: string,
    limit: number,
    expandedTokens?: string[],
  ): Promise<any[]> {
    const words =
      expandedTokens && expandedTokens.length > 0
        ? expandedTokens
        : this.expandQueryTokens(this.tokenizeQuery(query));
    if (words.length === 0) return [];

    const andQuery = this.buildTsQuery(words, '&');
    const orQuery = this.buildTsQuery(words, '|');
    const results = new Map<string, any>();

    if (andQuery) {
      try {
        const rows = await this.executeFullTextQuery(andQuery, limit);
        for (const row of rows) {
          results.set(row.htsNumber, row);
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    if (orQuery) {
      try {
        const rows = await this.executeFullTextQuery(orQuery, limit);
        for (const row of rows) {
          const existing = results.get(row.htsNumber);
          if (!existing || row.score > existing.score) {
            results.set(row.htsNumber, row);
          }
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    return [...results.values()]
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      )
      .slice(0, limit);
  }

  private async executeFullTextQuery(
    tsquery: string,
    limit: number,
  ): Promise<any[]> {
    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('hts.description', 'description')
      .addSelect('hts.chapter', 'chapter')
      .addSelect('hts.indent', 'indent')
      .addSelect(
        `ts_rank_cd(hts.searchVector, to_tsquery('english', :tsquery))`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .andWhere(`hts.searchVector @@ to_tsquery('english', :tsquery)`)
      .setParameters({ tsquery })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      htsNumber: row.htsNumber,
      description: row.description,
      chapter: row.chapter,
      indent: Number(row.indent) || 0,
      score: Number(row.score) || 0,
    }));
  }

  private async semanticAutocompleteSearch(
    query: string,
    limit: number,
  ): Promise<SemanticCandidate[]> {
    return this.semanticTextSearch(query, limit);
  }

  private async semanticTextSearch(
    query: string,
    limit: number,
  ): Promise<SemanticCandidate[]> {
    const embedding = await this.embeddingService.generateEmbedding(query);
    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('1 - (hts.embedding <=> :embedding)', 'similarity')
      .where('hts.isActive = :active', { active: true })
      .andWhere('hts.embedding IS NOT NULL')
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .setParameter('embedding', JSON.stringify(embedding))
      .orderBy('similarity', 'DESC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      htsNumber: row.htsNumber,
      similarity: Number(row.similarity) || 0,
    }));
  }

  private async searchByKeyword(
    query: string,
    limit: number,
    expandedTokens?: string[],
  ): Promise<KeywordCandidate[]> {
    // Check if query is HTS code or description search
    const isHtsCodeQuery = this.isLikelyHtsCodeQuery(query);

    if (isHtsCodeQuery) {
      return this.searchByCode(query, limit);
    }

    return this.searchByFullText(query, limit, expandedTokens);
  }

  /**
   * Search by HTS code pattern matching
   */
  private async searchByCode(
    query: string,
    limit: number,
  ): Promise<KeywordCandidate[]> {
    const normalizedCode = query.replace(/[^\d]/g, '');
    const containsQuery = `%${query}%`;
    const prefixQuery = `${query}%`;
    const normalizedPrefix = `${normalizedCode}%`;
    const normalizedContains = `%${normalizedCode}%`;

    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect(
        `CASE
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') = :normalizedCode THEN 1.0
          WHEN hts.htsNumber ILIKE :prefixQuery THEN 0.95
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedPrefix THEN 0.93
          WHEN hts.htsNumber ILIKE :containsQuery THEN 0.5
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains THEN 0.45
          ELSE 0
        END`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
      .andWhere("hts.chapter NOT IN ('98', '99')")

      .andWhere(
        new Brackets((qb) => {
          qb.where('hts.htsNumber ILIKE :containsQuery', { containsQuery });
          if (normalizedCode) {
            qb.orWhere(
              "REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains",
              {
                normalizedContains,
              },
            );
          }
        }),
      )
      .setParameters({
        normalizedCode,
        prefixQuery,
        normalizedPrefix,
        containsQuery,
        normalizedContains,
      })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      htsNumber: row.htsNumber,
      score: Number(row.score) || 0,
    }));
  }

  /**
   * Search by full-text search with ranking.
   * Strategy:
   *  1. Try AND of all words (most precise).
   *  2. Fallback: OR of all words — ts_rank_cd scores by how many words match,
   *     preserving multi-word context over single-word degeneration.
   */
  private async searchByFullText(
    query: string,
    limit: number,
    expandedTokens?: string[],
  ): Promise<KeywordCandidate[]> {
    const words =
      expandedTokens && expandedTokens.length > 0
        ? expandedTokens
        : this.expandQueryTokens(this.tokenizeQuery(query));
    if (words.length === 0) return [];

    const runQuery = async (
      tsquery: string,
    ): Promise<KeywordCandidate[]> => {
      const rows = await this.htsRepository
        .createQueryBuilder('hts')
        .select('hts.htsNumber', 'htsNumber')
        .addSelect(
          `ts_rank_cd(hts.searchVector, to_tsquery('english', :tsquery))`,
          'score',
        )
        .where('hts.isActive = :active', { active: true })
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .andWhere(`hts.searchVector @@ to_tsquery('english', :tsquery)`)
        .setParameters({ tsquery })
        .orderBy('score', 'DESC')
        .addOrderBy('hts.htsNumber', 'ASC')
        .limit(limit)
        .getRawMany();
      return rows.map((row) => ({
        htsNumber: row.htsNumber,
        score: Number(row.score) || 0,
      }));
    };

    const results = new Map<string, KeywordCandidate>();
    const andQuery = this.buildTsQuery(words, '&');
    const orQuery = this.buildTsQuery(words, '|');

    if (andQuery) {
      try {
        const rows = await runQuery(andQuery);
        for (const row of rows) {
          results.set(row.htsNumber, row);
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    if (orQuery) {
      try {
        const rows = await runQuery(orQuery);
        for (const row of rows) {
          const existing = results.get(row.htsNumber);
          if (!existing || row.score > existing.score) {
            results.set(row.htsNumber, row);
          }
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    return [...results.values()]
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      )
      .slice(0, limit);
  }

  async findByHtsNumber(htsNumber: string): Promise<HtsEntity | null> {
    return this.htsRepository.findOne({
      where: { htsNumber, isActive: true },
      select: [
        'htsNumber', 'chapter', 'heading', 'subheading', 'statisticalSuffix',
        'indent', 'description', 'parentHtsNumber', 'parentHtses', 'fullDescription',
        'hasChildren', 'isActive', 'unitOfQuantity',
        'general', 'generalRate', 'rateFormula', 'rateVariables',
        'other', 'otherRate', 'otherRateFormula', 'otherRateVariables',
        'specialRates', 'chapter99', 'chapter99Links', 'chapter99ApplicableCountries',
        'adjustedFormula', 'adjustedFormulaVariables',
        'effectiveDate', 'expirationDate', 'sourceVersion', 'importDate',
        'confirmed', 'requiredReview', 'requiredReviewComment',
        'metadata', 'createdAt', 'updatedAt',
      ],
    });
  }

  private normalizeQuery(query: string): string {
    return (query ?? '').trim().replace(/\s+/g, ' ');
  }

  private clampLimit(limit: number, fallback: number): number {
    if (!Number.isFinite(limit)) {
      return fallback;
    }
    return Math.max(1, Math.min(this.MAX_LIMIT, Math.floor(limit)));
  }

  private isLikelyHtsCodeQuery(query: string): boolean {
    const normalized = query.replace(/\s+/g, '');
    return (
      /^[\d.]+$/.test(normalized) ||
      /^\d{2,4}(\.\d{0,2}){0,3}$/.test(normalized)
    );
  }

  private classifyQueryIntent(query: string): QueryIntent {
    const compact = query.replace(/\s+/g, '');
    if (this.isLikelyHtsCodeQuery(compact)) {
      return 'code';
    }

    const hasAlpha = /[a-z]/i.test(query);
    const hasDigit = /\d/.test(query);
    if (hasAlpha && hasDigit) {
      return 'mixed';
    }
    return 'text';
  }

  private tokenizeQuery(query: string): string[] {
    const raw = (query || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    const stopWords = new Set([
      'a',
      'an',
      'the',
      'for',
      'and',
      'with',
      'to',
      'of',
      'in',
      'on',
      'by',
      'or',
      'at',
      'from',
    ]);

    return [...new Set(raw.filter((token) => token.length > 1 && !stopWords.has(token)))];
  }

  private expandQueryTokens(tokens: string[]): string[] {
    const expanded = new Set<string>();
    for (const token of tokens) {
      expanded.add(token);
      for (const synonym of this.QUERY_SYNONYMS[token] || []) {
        expanded.add(synonym);
      }
    }
    return [...expanded];
  }

  private sanitizeTsToken(token: string): string {
    return token.replace(/[^a-zA-Z0-9]/g, '');
  }

  private buildTsQuery(tokens: string[], operator: '&' | '|'): string {
    const safeTokens = tokens
      .map((token) => this.sanitizeTsToken(token))
      .filter((token) => token.length > 0);
    if (safeTokens.length === 0) {
      return '';
    }

    return safeTokens.map((token) => `${token}:*`).join(` ${operator} `);
  }

  private buildEntryText(entry: CandidateEntry): string {
    const hierarchy = (entry.fullDescription || []).join(' ');
    return `${entry.description || ''} ${hierarchy}`.trim().toLowerCase();
  }

  private computeCoverageScore(tokens: string[], text: string): number {
    if (tokens.length === 0 || !text) {
      return 0;
    }

    let covered = 0;
    for (const token of tokens) {
      if (token.length < 2) {
        continue;
      }
      if (text.includes(token)) {
        covered += 1;
      }
    }

    return covered / tokens.length;
  }

  private computePhraseBoost(query: string, text: string): number {
    const needle = query.trim().toLowerCase();
    if (!needle || needle.length < 4) {
      return 0;
    }

    return text.includes(needle) ? 0.2 : 0;
  }

  private computeSpecificityBoost(htsNumber: string): number {
    const digits = htsNumber.replace(/[^\d]/g, '').length;
    if (digits >= 10) {
      return 0.08;
    }
    if (digits >= 8) {
      return 0.04;
    }
    return 0;
  }

  private computeGenericPenalty(description: string, coverage: number): number {
    const normalized = (description || '').trim().toLowerCase();
    const isGeneric =
      this.GENERIC_LABELS.has(normalized) || normalized.startsWith('other');
    if (!isGeneric) {
      return 0;
    }

    return coverage >= 0.66 ? 0.05 : 0.28;
  }

  private rrf(rankIndex: number): number {
    return 1 / (this.RRF_K + rankIndex + 1);
  }

  private applyChapterDiversity<T extends { chapter?: string }>(
    rows: T[],
    limit: number,
    enabled: boolean,
  ): T[] {
    if (!enabled || rows.length <= limit) {
      return rows;
    }

    const perChapterCap = 3;
    const counts = new Map<string, number>();
    const selected: T[] = [];
    const deferred: T[] = [];

    for (const row of rows) {
      const chapter = row.chapter || 'unknown';
      const current = counts.get(chapter) || 0;
      if (current < perChapterCap) {
        selected.push(row);
        counts.set(chapter, current + 1);
      } else {
        deferred.push(row);
      }
    }

    const merged = [...selected, ...deferred];
    return merged.slice(0, limit);
  }

  private combineResults(
    semantic: SemanticCandidate[],
    keyword: KeywordCandidate[],
    limit: number,
  ): Array<{ htsNumber: string; score: number }> {
    const combined = new Map<
      string,
      {
        htsNumber: string;
        score: number;
        inSemantic: boolean;
        inKeyword: boolean;
      }
    >();

    semantic.forEach((result, index) => {
      combined.set(result.htsNumber, {
        htsNumber: result.htsNumber,
        score: this.rrf(index),
        inSemantic: true,
        inKeyword: false,
      });
    });

    keyword.forEach((result, index) => {
      const existing = combined.get(result.htsNumber);
      if (existing) {
        existing.score += this.rrf(index);
        existing.inKeyword = true;
      } else {
        combined.set(result.htsNumber, {
          htsNumber: result.htsNumber,
          score: this.rrf(index),
          inSemantic: false,
          inKeyword: true,
        });
      }
    });

    return Array.from(combined.values())
      .map((row) => ({
        htsNumber: row.htsNumber,
        score: row.score + (row.inKeyword && row.inSemantic ? 0.06 : 0),
      }))
      .sort((a, b) => {
        if (b.score === a.score) {
          return a.htsNumber.localeCompare(b.htsNumber);
        }
        return b.score - a.score;
      })
      .slice(0, limit);
  }
}
