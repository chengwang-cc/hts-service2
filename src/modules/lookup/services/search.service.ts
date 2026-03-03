import { Injectable, Logger, Optional } from '@nestjs/common';
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

interface QuerySignals {
  hasMediaIntent: boolean;
  hasComicIntent: boolean;
  hasTransformerToken: boolean;
  hasManufacturingToken: boolean;
  hasApparelIntent: boolean;
  hasTshirtIntent: boolean;
  hasCottonToken: boolean;
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
    comic: ['comics', 'manga', 'graphic', 'periodical', 'book', 'books'],
    comics: ['comic', 'manga', 'graphic', 'periodical', 'book', 'books'],
    manga: ['comic', 'comics', 'graphic', 'periodical', 'book', 'books'],
    periodical: ['journal', 'magazine', 'serial'],
    journal: ['periodical', 'magazine'],
    magazine: ['periodical', 'journal'],
    book: ['books', 'comic', 'comics', 'periodical', 'journal'],
    books: ['book', 'comic', 'comics', 'periodical', 'journal'],
    transformer: ['transformers'],
    transformers: ['transformer'],
    transfomer: ['transformer', 'transformers'],
    tshirt: ['tshirts', 'shirt', 'shirts', 'tee', 'apparel'],
    tshirts: ['tshirt', 'shirt', 'shirts', 'tee', 'apparel'],
    shirt: ['shirts', 'tshirt', 'tshirts', 'apparel'],
    shirts: ['shirt', 'tshirt', 'tshirts', 'apparel'],
    // HTS vocabulary: "electric" is the standard term in HTS headings
    electronic: ['electric', 'electrical'],
    electronics: ['electric', 'electrical'],
    electrical: ['electric', 'electronic'],
    // Common product descriptions
    maker: ['machine', 'apparatus'],
    makers: ['machine', 'apparatus'],
    dryer: ['drying'],
    dryers: ['drying'],
    washer: ['washing'],
    washers: ['washing'],
    freezer: ['freezing', 'refrigerating'],
    freezers: ['freezing', 'refrigerating'],
    cooler: ['cooling', 'refrigerating'],
    heater: ['heating'],
    heaters: ['heating'],
    blender: ['mixing'],
    grinder: ['grinding'],
    grinders: ['grinding'],
    printer: ['printing'],
    printers: ['printing'],
    scanner: ['scanning'],
    computer: ['computers', 'computing', 'data processing'],
    computers: ['computer', 'computing', 'data processing'],
    laptop: ['portable', 'computer', 'computers'],
    laptops: ['portable', 'computer', 'computers'],
    phone: ['telephone', 'telephones'],
    phones: ['telephone', 'telephones'],
    smartphone: ['telephone', 'cellular', 'mobile'],
    smartphones: ['telephone', 'cellular', 'mobile'],
    tv: ['television', 'televisions'],
    television: ['televisions', 'tv'],
    televisions: ['television', 'tv'],
    headphone: ['headphones', 'earphone'],
    headphones: ['headphone', 'earphone'],
    earphone: ['earphones', 'headphone'],
    earphones: ['earphone', 'headphone'],
    speaker: ['speakers', 'loudspeaker'],
    speakers: ['speaker', 'loudspeaker'],
    camera: ['cameras', 'photographic'],
    cameras: ['camera', 'photographic'],
    watch: ['watches', 'timepiece', 'wristwatch'],
    watches: ['watch', 'timepiece', 'wristwatch'],
    shoe: ['shoes', 'footwear'],
    shoes: ['shoe', 'footwear'],
    bag: ['bags', 'handbag', 'luggage'],
    bags: ['bag', 'handbag', 'luggage'],
  };

  private readonly MEDIA_INTENT_TOKENS = new Set([
    'comic',
    'comics',
    'manga',
    'book',
    'books',
    'periodical',
    'periodicals',
    'journal',
    'magazine',
    'newspaper',
    'graphic',
  ]);

  private readonly COMIC_INTENT_TOKENS = new Set([
    'comic',
    'comics',
    'manga',
    'graphic',
  ]);

  private readonly MEDIA_RESULT_HINTS = new Set([
    'comic',
    'comics',
    'manga',
    'book',
    'books',
    'periodical',
    'periodicals',
    'journal',
    'magazine',
    'newspaper',
    'paperbound',
    'hardbound',
  ]);

  private readonly COMIC_RESULT_HINTS = new Set([
    'comic',
    'comics',
    'manga',
    'graphic',
    'pages',
    'covers',
    'periodical',
    'periodicals',
  ]);

  private readonly COMIC_PAGE_HINTS = new Set([
    'page',
    'pages',
    'excluding',
    'covers',
  ]);

  private readonly STATIONERY_HINTS = new Set([
    'diaries',
    'diary',
    'address',
    'exercise',
    'composition',
    'notebook',
    'notebooks',
  ]);

  private readonly MACHINERY_HINTS = new Set([
    'machinery',
    'machine',
    'parts',
    'printing',
    'binding',
    'bind',
  ]);

  private readonly ELECTRICAL_TRANSFORMER_HINTS = new Set([
    'transformer',
    'transformers',
    'electrical',
    'voltage',
    'coil',
    'core',
    'wound',
    'stacked',
  ]);

  private readonly APPAREL_INTENT_TOKENS = new Set([
    'tshirt',
    'tshirts',
    'shirt',
    'shirts',
    'tee',
    'apparel',
    'garment',
    'clothing',
  ]);

  private readonly MANUFACTURING_TOKENS = new Set([
    'machine',
    'machinery',
    'printer',
    'printing',
    'equipment',
    'industrial',
  ]);

  private readonly APPAREL_RESULT_HINTS = new Set([
    'tshirt',
    'tshirts',
    'shirt',
    'shirts',
    'tee',
    'apparel',
    'garment',
    'pullover',
    'jersey',
    'undershirt',
    'singlet',
  ]);

  private readonly TSHIRT_RESULT_HINTS = new Set([
    'tshirt',
    'tshirts',
    'tee',
    'crew',
    'neckline',
    'undershirt',
  ]);

  private readonly YARN_RESULT_HINTS = new Set([
    'yarn',
    'spun',
    'thread',
    'fiber',
    'fibers',
    'filament',
  ]);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    @Optional() private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * Fast keyword-only HTS search — no embedding, no DGX rerank.
   * Used by the OpenAI agent path where sub-second search latency matters.
   * Runs PostgreSQL full-text search + scoring and returns top results.
   */
  async fastTextSearch(query: string, limit: number = 10): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 10);
    if (!normalizedQuery) return [];

    const queryTokens = this.tokenizeQuery(normalizedQuery);
    const signals = this.buildQuerySignals(queryTokens);
    const lexicalTokens = this.buildLexicalTokens(queryTokens, signals);
    const expandedTokens = this.expandQueryTokens(lexicalTokens);

    const keywordCandidates = await this.searchByKeyword(
      normalizedQuery,
      Math.min(this.MAX_LIMIT, safeLimit * 4),
      expandedTokens,
    );
    if (keywordCandidates.length === 0) return [];

    const htsNumbers = keywordCandidates.map((r) => r.htsNumber);
    const entries = await this.htsRepository.find({
      where: { htsNumber: In(htsNumbers), isActive: true },
      select: ['htsNumber', 'description', 'chapter', 'indent', 'fullDescription'],
    });
    const entryByHts = new Map(entries.map((e) => [e.htsNumber, e]));

    const scored = keywordCandidates
      .map((r) => {
        const entry = entryByHts.get(r.htsNumber);
        if (!entry) return null;
        const coverage = this.computeCoverageScore(queryTokens, this.buildEntryText(entry));
        const phraseBoost = this.computePhraseBoost(normalizedQuery, this.buildEntryText(entry));
        const specificityBoost = this.computeSpecificityBoost(entry.htsNumber);
        const genericPenalty = this.computeGenericPenalty(entry.description, coverage);
        const tokenSet = this.buildEntryTokenSet(entry);
        const intentBoost = this.computeIntentBoost(signals, entry, tokenSet);
        const intentPenalty = this.computeIntentPenalty(signals, entry, tokenSet);
        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: entry.indent,
          fullDescription: entry.fullDescription ?? null,
          score: r.score + coverage * 0.7 + phraseBoost + specificityBoost - genericPenalty + intentBoost - intentPenalty,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.score === a.score ? a.htsNumber.localeCompare(b.htsNumber) : b.score - a.score));

    return scored.slice(0, safeLimit);
  }

  async hybridSearch(query: string, limit: number = 20): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 20);
    if (!normalizedQuery) {
      return [];
    }

    const queryTokens = this.tokenizeQuery(normalizedQuery);
    const signals = this.buildQuerySignals(queryTokens);
    const lexicalTokens = this.buildLexicalTokens(queryTokens, signals);
    const expandedTokens = this.expandQueryTokens(lexicalTokens);

    const keywordResults = await this.searchByKeyword(
      normalizedQuery,
      Math.min(this.MAX_LIMIT, safeLimit * 4),
      expandedTokens,
    );
    // No semantic (DGX embedding) or reranker (DGX cross-encoder) calls —
    // keyword-only RRF + hand-tuned scoring is the ranking pipeline.
    const combined = this.combineResults(
      [],
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
          queryTokens,
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
        const tokenSet = this.buildEntryTokenSet(entry);
        if (
          signals.hasComicIntent &&
          !signals.hasManufacturingToken &&
          entry.chapter === '84'
        ) {
          return null;
        }
        if (
          signals.hasComicIntent &&
          entry.chapter !== '49' &&
          !this.hasTokenOverlap(tokenSet, this.MEDIA_RESULT_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasComicIntent &&
          entry.chapter === '48' &&
          this.hasTokenOverlap(tokenSet, this.STATIONERY_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasTshirtIntent &&
          entry.chapter === '62' &&
          !this.hasTokenOverlap(tokenSet, this.TSHIRT_RESULT_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasTshirtIntent &&
          entry.chapter !== '61' &&
          entry.chapter !== '62' &&
          !this.hasTokenOverlap(tokenSet, this.TSHIRT_RESULT_HINTS)
        ) {
          return null;
        }
        const intentBoost = this.computeIntentBoost(signals, entry, tokenSet);
        const intentPenalty = this.computeIntentPenalty(
          signals,
          entry,
          tokenSet,
        );

        const score =
          result.score +
          coverage * 0.7 +
          phraseBoost +
          specificityBoost -
          genericPenalty +
          intentBoost -
          intentPenalty;

        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: entry.indent,
          fullDescription: entry.fullDescription ?? null,
          score,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      );

    const diversifiedRows = this.applyChapterDiversity(
      reranked,
      safeLimit,
      expandedTokens.length >= 3,
    );

    // Normalize hand-tuned scores relative to the top result so the UI shows
    // meaningful percentages (top = 100%, others proportionally lower).
    // Clamping negatives to 0 before dividing keeps all display values in [0, 1].
    const finalRows = diversifiedRows.slice(0, safeLimit);
    const maxScore = finalRows.length > 0 ? Math.max(...finalRows.map((r) => r.score)) : 0;
    if (maxScore <= 0) {
      return finalRows;
    }
    return finalRows.map((r) => ({
      ...r,
      score: Math.max(r.score, 0) / maxScore,
    }));
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
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
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

  /**
   * Semantic autocomplete search using pgvector cosine similarity.
   * Embeds the query via EmbeddingService (DGX BGE-M3 primary, Redis-cached).
   * Returns up to `limit` leaf HTS codes sorted by cosine similarity.
   */
  private async semanticAutocompleteSearch(
    query: string,
    limit: number,
  ): Promise<SemanticCandidate[]> {
    if (!this.embeddingService) return [];
    try {
      const embedding = await this.embeddingService.generateEmbedding(query);
      const rows = await this.htsRepository
        .createQueryBuilder('hts')
        .select('hts.htsNumber', 'htsNumber')
        .addSelect('1 - (hts.embedding <=> :embedding)', 'similarity')
        .where('hts.isActive = :active', { active: true })
        .andWhere('hts.embedding IS NOT NULL')
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .setParameter('embedding', JSON.stringify(embedding))
        .orderBy('similarity', 'DESC')
        .limit(limit)
        .getRawMany<{ htsNumber: string; similarity: string }>();
      return rows.map((r) => ({
        htsNumber: r.htsNumber,
        similarity: parseFloat(r.similarity),
      }));
    } catch (err) {
      this.logger.warn(
        `Semantic autocomplete failed, skipping: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async autocompleteByTextHybrid(
    query: string,
    limit: number,
    includeCodeCandidates: boolean,
  ): Promise<any[]> {
    const baseTokens = this.tokenizeQuery(query);
    const signals = this.buildQuerySignals(baseTokens);
    const lexicalTokens = this.buildLexicalTokens(baseTokens, signals);
    const expandedTokens = this.expandQueryTokens(lexicalTokens);
    const candidateLimit = Math.min(this.MAX_LIMIT, Math.max(limit * 5, 30));

    const lexicalPromise = this.autocompleteByFullText(
      query,
      candidateLimit,
      expandedTokens,
    );
    const codePromise = includeCodeCandidates
      ? this.autocompleteByCode(query, Math.min(candidateLimit, 20))
      : Promise.resolve([] as any[]);
    const semanticPromise = this.semanticAutocompleteSearch(
      query,
      candidateLimit,
    );

    const [lexicalRows, codeRows, semanticRows] = await Promise.all([
      lexicalPromise,
      codePromise,
      semanticPromise,
    ]);

    const fused = new Map<string, number>();
    lexicalRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });
    codeRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });
    semanticRows.forEach((row, index) => {
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
        const coverage = this.computeCoverageScore(baseTokens, text);
        const phraseBoost = this.computePhraseBoost(query, text);
        const specificityBoost = this.computeSpecificityBoost(htsNumber);
        const genericPenalty = this.computeGenericPenalty(
          entry.description,
          coverage,
        );
        const tokenSet = this.buildEntryTokenSet(entry);
        if (
          signals.hasComicIntent &&
          !signals.hasManufacturingToken &&
          entry.chapter === '84'
        ) {
          return null;
        }
        if (
          signals.hasComicIntent &&
          entry.chapter !== '49' &&
          !this.hasTokenOverlap(tokenSet, this.MEDIA_RESULT_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasComicIntent &&
          entry.chapter === '48' &&
          this.hasTokenOverlap(tokenSet, this.STATIONERY_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasTshirtIntent &&
          entry.chapter === '62' &&
          !this.hasTokenOverlap(tokenSet, this.TSHIRT_RESULT_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasTshirtIntent &&
          entry.chapter !== '61' &&
          entry.chapter !== '62' &&
          !this.hasTokenOverlap(tokenSet, this.TSHIRT_RESULT_HINTS)
        ) {
          return null;
        }
        const intentBoost = this.computeIntentBoost(signals, entry, tokenSet);
        const intentPenalty = this.computeIntentPenalty(signals, entry, tokenSet);

        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: Number(entry.indent) || 0,
          fullDescription: entry.fullDescription ?? null,
          score:
            base +
            coverage * 0.85 +
            phraseBoost +
            specificityBoost -
            genericPenalty +
            intentBoost -
            intentPenalty,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      );

    if (ranked.length === 0) {
      return [];
    }

    // Normalize scores relative to the top result (top = 100%, others proportional).
    // The 0.5 filter keeps only results within 50% of the best match.
    const maxScore = Math.max(...ranked.map((r) => r.score));
    if (maxScore <= 0) {
      return [];
    }
    const normalized = ranked
      .map((r) => ({ ...r, score: Math.max(r.score, 0) / maxScore }))
      .filter((r) => r.score >= 0.5);

    const diversified = this.applyChapterDiversity(
      normalized,
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
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
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
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
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
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
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
    const normalized = (query ?? '').trim().replace(/\s+/g, ' ');
    return normalized
      .replace(/\btransfomer\b/gi, 'transformer')
      .replace(/\btranformer\b/gi, 'transformer')
      .replace(/\bcomic[\s-]?books?\b/gi, 'comic book')
      .replace(/\bt[\s-]?shirts?\b/gi, 'tshirt')
      .trim()
      .replace(/\s+/g, ' ');
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

    const corrected = raw.map((token) => {
      if (token === 'transfomer' || token === 'tranformer') {
        return 'transformer';
      }
      return token;
    });

    return [
      ...new Set(
        corrected.filter((token) => token.length > 1 && !stopWords.has(token)),
      ),
    ];
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

  private buildEntryTokenSet(entry: CandidateEntry): Set<string> {
    const text = this.buildEntryText(entry);
    return new Set(text.match(/[a-z0-9]+/g) || []);
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

  private computeSpecificityBoost(_htsNumber: string): number {
    return 0.08;
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

  private buildQuerySignals(tokens: string[]): QuerySignals {
    const tokenSet = new Set(tokens);

    const hasAny = (source: Set<string>): boolean => {
      for (const token of source) {
        if (tokenSet.has(token)) {
          return true;
        }
      }
      return false;
    };

    return {
      hasMediaIntent: hasAny(this.MEDIA_INTENT_TOKENS),
      hasComicIntent: hasAny(this.COMIC_INTENT_TOKENS),
      hasTransformerToken:
        tokenSet.has('transformer') || tokenSet.has('transformers'),
      hasManufacturingToken: hasAny(this.MANUFACTURING_TOKENS),
      hasApparelIntent: hasAny(this.APPAREL_INTENT_TOKENS),
      hasTshirtIntent: tokenSet.has('tshirt') || tokenSet.has('tshirts'),
      hasCottonToken: tokenSet.has('cotton'),
    };
  }

  private buildLexicalTokens(
    queryTokens: string[],
    signals: QuerySignals,
  ): string[] {
    if (!signals.hasMediaIntent || !signals.hasTransformerToken) {
      return queryTokens;
    }

    const filtered = queryTokens.filter(
      (token) => token !== 'transformer' && token !== 'transformers',
    );
    return filtered.length > 0 ? filtered : queryTokens;
  }

  private computeIntentBoost(
    signals: QuerySignals,
    entry: CandidateEntry,
    entryTokens: Set<string>,
  ): number {
    let boost = 0;

    if (signals.hasMediaIntent) {
      if (entry.chapter === '49') {
        boost += 0.38;
      }
      if (this.hasTokenOverlap(entryTokens, this.MEDIA_RESULT_HINTS)) {
        boost += 0.42;
      }
    }

    if (signals.hasComicIntent) {
      if (
        entry.htsNumber.startsWith('4901.99.00.9') ||
        entry.htsNumber.startsWith('4902.')
      ) {
        boost += 0.48;
      }
      if (this.hasTokenOverlap(entryTokens, this.COMIC_RESULT_HINTS)) {
        boost += 0.35;
      }
      if (this.hasTokenOverlap(entryTokens, this.COMIC_PAGE_HINTS)) {
        boost += 0.18;
      }
    }

    if (signals.hasApparelIntent) {
      if (entry.chapter === '61' || entry.chapter === '62') {
        boost += 0.35;
      }
      if (this.hasTokenOverlap(entryTokens, this.APPAREL_RESULT_HINTS)) {
        boost += 0.3;
      }
      if (signals.hasCottonToken && (entry.chapter === '61' || entry.chapter === '62')) {
        boost += 0.08;
      }
    }

    if (signals.hasTshirtIntent) {
      if (entry.htsNumber.startsWith('6109.')) {
        boost += 0.55;
      }
      if (this.hasTokenOverlap(entryTokens, this.TSHIRT_RESULT_HINTS)) {
        boost += 0.3;
      }
    }

    return boost;
  }

  private computeIntentPenalty(
    signals: QuerySignals,
    entry: CandidateEntry,
    entryTokens: Set<string>,
  ): number {
    let penalty = 0;

    if (signals.hasMediaIntent && signals.hasTransformerToken) {
      if (entry.chapter === '85' && this.hasTokenOverlap(entryTokens, this.ELECTRICAL_TRANSFORMER_HINTS)) {
        penalty += 1.05;
      }
    }

    if (signals.hasComicIntent) {
      if (
        entry.chapter === '48' &&
        this.hasTokenOverlap(entryTokens, this.STATIONERY_HINTS)
      ) {
        penalty += 0.7;
      }
      if (
        entry.chapter === '84' &&
        this.hasTokenOverlap(entryTokens, this.MACHINERY_HINTS)
      ) {
        penalty += 0.8;
      }

      if (
        entry.chapter !== '49' &&
        !this.hasTokenOverlap(entryTokens, this.MEDIA_RESULT_HINTS)
      ) {
        penalty += 0.35;
      }
    }

    if (signals.hasApparelIntent) {
      if (entry.chapter === '52' && this.hasTokenOverlap(entryTokens, this.YARN_RESULT_HINTS)) {
        penalty += 0.45;
      }
    }

    if (signals.hasTshirtIntent) {
      const description = (entry.description || '').toLowerCase();
      if (description.includes('subject to cotton restraints')) {
        penalty += 0.55;
      }
      if (
        entry.chapter === '62' &&
        !this.hasTokenOverlap(entryTokens, this.TSHIRT_RESULT_HINTS)
      ) {
        penalty += 0.75;
      }
    }

    return penalty;
  }

  private hasTokenOverlap(tokenSet: Set<string>, reference: Set<string>): boolean {
    for (const token of reference) {
      if (tokenSet.has(token)) {
        return true;
      }
    }
    return false;
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
