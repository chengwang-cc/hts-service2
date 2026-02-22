import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { HtsEntity, EmbeddingService } from '@hts/core';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly MAX_LIMIT = 100;

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

    let semanticResults: Array<{ htsNumber: string; similarity: number }> = [];
    const shouldRunSemantic =
      normalizedQuery.length >= 4 &&
      !this.isLikelyHtsCodeQuery(normalizedQuery);

    if (shouldRunSemantic) {
      try {
        const embedding =
          await this.embeddingService.generateEmbedding(normalizedQuery);
        const semanticRaw = await this.htsRepository
          .createQueryBuilder('hts')
          .select('hts.htsNumber', 'htsNumber')
          .addSelect('1 - (hts.embedding <=> :embedding)', 'similarity')
          .where('hts.isActive = :active', { active: true })
          .andWhere('hts.embedding IS NOT NULL')
          .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
          .andWhere("hts.chapter NOT IN ('98', '99')")
          .setParameter('embedding', JSON.stringify(embedding))
          .orderBy('similarity', 'DESC')
          .limit(safeLimit)
          .getRawMany();
        semanticResults = semanticRaw.map((row) => ({
          htsNumber: row.htsNumber,
          similarity: Number(row.similarity) || 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Semantic search unavailable, falling back to keyword-only search: ${message}`,
        );
      }
    }

    const keywordResults = await this.searchByKeyword(
      normalizedQuery,
      safeLimit,
    );
    const combined = this.combineResults(
      semanticResults,
      keywordResults,
      safeLimit,
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
      select: ['htsNumber', 'description', 'chapter', 'indent'],
    });
    const entryByHts = new Map(
      entries.map((entry) => [entry.htsNumber, entry]),
    );

    return combined
      .map((result) => {
        const entry = entryByHts.get(result.htsNumber);
        if (!entry) {
          return null;
        }
        return {
          ...result,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: entry.indent,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }

  async autocomplete(query: string, limit: number = 10): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 10);
    if (normalizedQuery.length < 2) {
      return [];
    }

    // Check if query is likely an HTS code (numbers and dots)
    const isHtsCodeQuery = this.isLikelyHtsCodeQuery(normalizedQuery);

    if (isHtsCodeQuery) {
      // Use pattern matching for HTS code queries
      return this.autocompleteByCode(normalizedQuery, safeLimit);
    }

    // Use full-text search for description queries
    return this.autocompleteByFullText(normalizedQuery, safeLimit);
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
  ): Promise<any[]> {
    const words = query.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return [];

    // 1. Try AND of all words first
    const andQuery = words.map((w) => `${w}:*`).join(' & ');
    try {
      const rows = await this.executeFullTextQuery(andQuery, limit);
      if (rows.length > 0) return rows;
    } catch {
      // Invalid tsquery (stop words only), fall through
    }

    // 2. Fallback: OR of all words — ts_rank naturally ranks entries that
    //    match more query words higher, preserving multi-word context.
    if (words.length > 1) {
      const orQuery = words.map((w) => `${w}:*`).join(' | ');
      try {
        const rows = await this.executeFullTextQuery(orQuery, limit);
        if (rows.length > 0) return rows;
      } catch {
        // ignore
      }
    }

    return [];
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

  private async searchByKeyword(
    query: string,
    limit: number,
  ): Promise<Array<{ htsNumber: string; score: number }>> {
    // Check if query is HTS code or description search
    const isHtsCodeQuery = this.isLikelyHtsCodeQuery(query);

    if (isHtsCodeQuery) {
      return this.searchByCode(query, limit);
    }

    return this.searchByFullText(query, limit);
  }

  /**
   * Search by HTS code pattern matching
   */
  private async searchByCode(
    query: string,
    limit: number,
  ): Promise<Array<{ htsNumber: string; score: number }>> {
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
  ): Promise<Array<{ htsNumber: string; score: number }>> {
    const words = query.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return [];

    const runQuery = async (
      tsquery: string,
    ): Promise<Array<{ htsNumber: string; score: number }>> => {
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

    // 1. Try AND of all words first
    const andQuery = words.map((w) => `${w}:*`).join(' & ');
    try {
      const rows = await runQuery(andQuery);
      if (rows.length > 0) return rows;
    } catch {
      // Invalid tsquery (stop words only), fall through
    }

    // 2. Fallback: OR of all words — ts_rank_cd naturally ranks entries that
    //    match more query words higher, preserving multi-word context.
    if (words.length > 1) {
      const orQuery = words.map((w) => `${w}:*`).join(' | ');
      try {
        const rows = await runQuery(orQuery);
        if (rows.length > 0) return rows;
      } catch {
        // ignore
      }
    }

    return [];
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

  private combineResults(
    semantic: Array<{ htsNumber: string; similarity: number }>,
    keyword: Array<{ htsNumber: string; score: number }>,
    limit: number,
  ): Array<{ htsNumber: string; score: number }> {
    const combined = new Map<string, { htsNumber: string; score: number }>();

    semantic.forEach((result, index) => {
      combined.set(result.htsNumber, {
        htsNumber: result.htsNumber,
        score:
          result.similarity * 0.7 +
          (1 - index / Math.max(semantic.length, 1)) * 0.3,
      });
    });

    keyword.forEach((result) => {
      const existing = combined.get(result.htsNumber);
      if (existing) {
        // Already found semantically — keyword match is a strong signal, boost it
        existing.score += 0.3 + result.score * 0.35;
      } else {
        // Keyword-only match: the entry literally contains the search term.
        // Give it a meaningful base score so it competes with mid-ranked semantic results.
        combined.set(result.htsNumber, {
          htsNumber: result.htsNumber,
          score: 0.5 + result.score * 0.35,
        });
      }
    });

    return Array.from(combined.values())
      .sort((a, b) => {
        if (b.score === a.score) {
          return a.htsNumber.localeCompare(b.htsNumber);
        }
        return b.score - a.score;
      })
      .slice(0, limit);
  }
}
