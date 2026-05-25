import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EmbeddingService } from '@hts/core';
import { Brackets, Repository } from 'typeorm';
import { CbpCrossRulingEntity } from '../entities/cbp-cross-ruling.entity';

type JsonObject = Record<string, unknown>;

interface CrossSearchResult {
  rulingNumber?: string;
  subject?: string;
  categories?: string;
  rulingDate?: string;
  collection?: string;
  tariffs?: string[];
}

export interface IngestCrossRulingsOptions {
  terms?: string[];
  limit?: number;
  pageSize?: number;
  generateEmbeddings?: boolean;
}

export interface IngestCrossRulingsResult {
  searchedTerms: number;
  fetched: number;
  upserted: number;
  embeddingsGenerated: number;
}

export interface CrossRulingRetrievalContext {
  description?: string | null;
  rateText?: string | null;
  formulaText?: string | null;
  componentType?: string | null;
}

interface CrossRulingRetrievalMatch {
  strategy: 'exact_hts' | 'ancestor_hts' | 'text' | 'vector';
  score: number;
  matchedValue?: string;
  similarity?: number;
}

@Injectable()
export class CbpCrossRulingService {
  private readonly logger = new Logger(CbpCrossRulingService.name);
  private readonly baseUrl =
    process.env.CBP_CROSS_BASE_URL || 'https://rulings.cbp.gov';

  constructor(
    @InjectRepository(CbpCrossRulingEntity)
    private readonly rulingRepo: Repository<CbpCrossRulingEntity>,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async ingestRulings(
    options: IngestCrossRulingsOptions = {},
  ): Promise<IngestCrossRulingsResult> {
    const terms = options.terms?.length
      ? options.terms
      : (
          process.env.CBP_CROSS_INGEST_TERMS ||
          'tariff,HTS,section 301,section 232'
        )
          .split(',')
          .map((term) => term.trim())
          .filter(Boolean);
    const pageSize = Math.min(Math.max(options.pageSize ?? 10, 1), 100);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 1000);
    let fetched = 0;
    let upserted = 0;
    let embeddingsGenerated = 0;
    const seen = new Set<string>();

    for (const term of terms) {
      if (fetched >= limit) {
        break;
      }
      const results = await this.search(term, pageSize);
      for (const result of results) {
        if (fetched >= limit) {
          break;
        }
        const rulingNumber = result.rulingNumber?.trim();
        if (!rulingNumber || seen.has(rulingNumber)) {
          continue;
        }
        seen.add(rulingNumber);
        const detail = await this.fetchRulingText(rulingNumber);
        fetched++;
        const ruling = await this.upsertRuling(result, detail);
        upserted++;
        if (options.generateEmbeddings) {
          const generated = await this.generateEmbedding(ruling);
          if (generated) {
            embeddingsGenerated++;
          }
        }
      }
    }

    this.logger.log(
      `cbp-cross-ingest: terms=${terms.length} fetched=${fetched} upserted=${upserted} embeddings=${embeddingsGenerated}`,
    );

    return {
      searchedTerms: terms.length,
      fetched,
      upserted,
      embeddingsGenerated,
    };
  }

  async findRelevantRulingsForHts(
    htsNumber: string,
    limit: number = 5,
    context: CrossRulingRetrievalContext = {},
  ): Promise<CbpCrossRulingEntity[]> {
    const normalized = this.normalizeHts(htsNumber);
    if (!normalized) {
      return [];
    }
    const boundedLimit = Math.min(Math.max(limit, 1), 25);
    const ancestors = this.ancestorHtsNumbers(normalized);
    const matches = new Map<
      string,
      { ruling: CbpCrossRulingEntity; matches: CrossRulingRetrievalMatch[] }
    >();
    const addMatch = (
      ruling: CbpCrossRulingEntity,
      match: CrossRulingRetrievalMatch,
    ) => {
      const current = matches.get(ruling.id);
      if (current) {
        current.matches.push(match);
      } else {
        matches.set(ruling.id, { ruling, matches: [match] });
      }
    };

    const exact = await this.rulingRepo
      .createQueryBuilder('ruling')
      .where('ruling.status = :status', { status: 'active' })
      .andWhere(
        new Brackets((qb) => {
          ancestors.forEach((ancestor, index) => {
            const clause = `:ancestor${index} = ANY(ruling.htsNumbers)`;
            const params = { [`ancestor${index}`]: ancestor };
            if (index === 0) {
              qb.where(clause, params);
            } else {
              qb.orWhere(clause, params);
            }
          });
        }),
      )
      .orderBy('ruling.rulingDate', 'DESC', 'NULLS LAST')
      .limit(boundedLimit)
      .getMany();

    for (const ruling of exact) {
      const matchedValue = this.bestMatchedHts(ruling.htsNumbers, ancestors);
      addMatch(ruling, {
        strategy: matchedValue === normalized ? 'exact_hts' : 'ancestor_hts',
        score: matchedValue === normalized ? 1 : 0.85,
        matchedValue: matchedValue || undefined,
      });
    }

    if (matches.size < boundedLimit) {
      const textTerms = this.textSearchTerms(normalized, context);
      const fallback = await this.rulingRepo
        .createQueryBuilder('ruling')
        .where('ruling.status = :status', { status: 'active' })
        .andWhere(
          new Brackets((qb) => {
            textTerms.forEach((term, index) => {
              const clause =
                'ruling.rulingText ILIKE :term' +
                index +
                ' OR ruling.subject ILIKE :term' +
                index;
              const params = { [`term${index}`]: `%${term}%` };
              if (index === 0) {
                qb.where(clause, params);
              } else {
                qb.orWhere(clause, params);
              }
            });
          }),
        )
        .orderBy('ruling.rulingDate', 'DESC', 'NULLS LAST')
        .limit(boundedLimit)
        .getMany();

      for (const ruling of fallback) {
        addMatch(ruling, {
          strategy: 'text',
          score: 0.65,
          matchedValue: this.firstMatchedTextTerm(ruling, textTerms),
        });
      }
    }

    if (matches.size < boundedLimit) {
      const vectorMatches = await this.vectorSearchRelevantRulings(
        normalized,
        context,
        boundedLimit,
      );
      for (const item of vectorMatches) {
        addMatch(item.ruling, {
          strategy: 'vector',
          score: Math.max(0, Math.min(0.8, item.similarity)),
          similarity: item.similarity,
        });
      }
    }

    return Array.from(matches.values())
      .sort((a, b) => {
        const scoreDelta = this.bestScore(b.matches) - this.bestScore(a.matches);
        if (scoreDelta !== 0) return scoreDelta;
        return this.rulingDateTime(b.ruling) - this.rulingDateTime(a.ruling);
      })
      .slice(0, boundedLimit)
      .map(({ ruling, matches: rulingMatches }) =>
        this.withRetrievalMetadata(ruling, normalized, rulingMatches),
      );
  }

  async generatePendingEmbeddings(limit: number = 100): Promise<number> {
    const rows = await this.rulingRepo.find({
      where: { embeddingStatus: 'pending' },
      order: { rulingDate: 'DESC' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
    let generated = 0;
    for (const row of rows) {
      if (await this.generateEmbedding(row)) {
        generated++;
      }
    }
    return generated;
  }

  private async search(
    term: string,
    pageSize: number,
  ): Promise<CrossSearchResult[]> {
    const url = new URL('/api/search', this.baseUrl);
    url.searchParams.set('term', term);
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('page', '1');
    const json = await this.fetchJson<{ rulings?: CrossSearchResult[] }>(
      url.toString(),
    );
    return json.rulings || [];
  }

  private async fetchRulingText(
    rulingNumber: string,
  ): Promise<{ text: string; raw: JsonObject }> {
    const url = new URL(
      `/api/ruling/${encodeURIComponent(rulingNumber)}`,
      this.baseUrl,
    );
    const json = await this.fetchJson<JsonObject>(url.toString());
    return {
      text: typeof json.text === 'string' ? json.text : '',
      raw: json,
    };
  }

  private async upsertRuling(
    result: CrossSearchResult,
    detail: { text: string; raw: JsonObject },
  ): Promise<CbpCrossRulingEntity> {
    const collection = (result.collection || 'unknown').toLowerCase();
    const rulingNumber = result.rulingNumber?.trim() || 'unknown';
    const htsNumbers = Array.from(
      new Set(
        [
          ...(result.tariffs || []).map((value) => this.normalizeHts(value)),
          ...this.extractHtsNumbers(detail.text),
        ].filter((value): value is string => !!value),
      ),
    );
    const existing = await this.rulingRepo.findOne({
      where: { collection, rulingNumber },
    });
    const values = {
      collection,
      rulingNumber,
      subject: result.subject || rulingNumber,
      rulingDate: result.rulingDate ? result.rulingDate.slice(0, 10) : null,
      categories: result.categories || null,
      htsNumbers,
      rulingText: detail.text,
      sourceUrl: `${this.baseUrl}/search?term=${encodeURIComponent(rulingNumber)}`,
      documentUrl: `${this.baseUrl}/api/ruling/${encodeURIComponent(rulingNumber)}`,
      status: 'active',
      embeddingStatus:
        existing?.embeddingStatus === 'generated' ? 'generated' : 'pending',
      metadata: {
        source: 'cbp_cross',
        rawSearchResult: result as unknown as JsonObject,
        rawDetail: detail.raw,
      },
    };

    return this.rulingRepo.save(
      existing ? { ...existing, ...values } : this.rulingRepo.create(values),
    );
  }

  private async generateEmbedding(
    ruling: CbpCrossRulingEntity,
  ): Promise<boolean> {
    const searchText = this.buildSearchText(ruling);
    if (searchText.length < 20) {
      return false;
    }
    try {
      const embedding =
        await this.embeddingService.generateEmbedding(searchText);
      const provider = this.embeddingService.providerInfo.provider;
      await this.rulingRepo.save({
        ...ruling,
        embeddingSearchText: searchText,
        embedding: provider === 'dgx' ? embedding : ruling.embedding,
        embeddingOpenai:
          provider === 'openai' ? embedding : ruling.embeddingOpenai,
        embeddingModel:
          provider === 'openai' ? 'text-embedding-3-small' : 'bge-m3',
        embeddingStatus: 'generated',
        embeddingGeneratedAt: new Date(),
      });
      return true;
    } catch (error) {
      await this.rulingRepo.save({
        ...ruling,
        embeddingStatus: 'failed',
        metadata: {
          ...(ruling.metadata || {}),
          embeddingError:
            error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  private buildSearchText(ruling: CbpCrossRulingEntity): string {
    return [
      ruling.rulingNumber,
      ruling.subject,
      ruling.categories,
      ruling.htsNumbers.join(' '),
      ruling.rulingText,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 12000);
  }

  private async vectorSearchRelevantRulings(
    normalizedHts: string,
    context: CrossRulingRetrievalContext,
    limit: number,
  ): Promise<Array<{ ruling: CbpCrossRulingEntity; similarity: number }>> {
    const queryText = this.buildRetrievalQueryText(normalizedHts, context);
    if (queryText.length < 20) {
      return [];
    }

    try {
      const embedding =
        await this.embeddingService.generateEmbedding(queryText);
      const { column, property } = this.embeddingService.providerInfo;
      const result = await this.rulingRepo
        .createQueryBuilder('ruling')
        .addSelect(`1 - (ruling.${column} <=> :embedding)`, 'similarity')
        .where('ruling.status = :status', { status: 'active' })
        .andWhere('ruling.embeddingStatus = :embeddingStatus', {
          embeddingStatus: 'generated',
        })
        .andWhere(`ruling.${property} IS NOT NULL`)
        .setParameter('embedding', JSON.stringify(embedding))
        .orderBy('similarity', 'DESC')
        .addOrderBy('ruling.rulingDate', 'DESC', 'NULLS LAST')
        .limit(limit)
        .getRawAndEntities();

      return result.entities.map((ruling, index) => ({
        ruling,
        similarity: Number(result.raw[index]?.similarity) || 0,
      }));
    } catch (error) {
      this.logger.warn(
        `cbp-cross-vector-retrieval failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private buildRetrievalQueryText(
    normalizedHts: string,
    context: CrossRulingRetrievalContext,
  ): string {
    return [
      normalizedHts,
      normalizedHts.replace(/\D/g, ''),
      context.description,
      context.componentType,
      context.rateText,
      context.formulaText,
    ]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
  }

  private ancestorHtsNumbers(normalized: string): string[] {
    const digits = normalized.replace(/\D/g, '');
    const ancestors = [
      this.normalizeHts(digits),
      digits.length >= 8 ? this.normalizeHts(digits.slice(0, 8)) : null,
      digits.length >= 6 ? this.normalizeHts(digits.slice(0, 6)) : null,
    ].filter((value): value is string => !!value);
    return Array.from(new Set(ancestors));
  }

  private textSearchTerms(
    normalized: string,
    context: CrossRulingRetrievalContext,
  ): string[] {
    const digits = normalized.replace(/\D/g, '');
    const terms = [
      normalized,
      digits,
      digits.slice(0, 8),
      digits.slice(0, 6),
      context.description,
      context.rateText,
      context.componentType,
    ]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length >= 3);
    return Array.from(new Set(terms)).slice(0, 8);
  }

  private bestMatchedHts(
    rulingHtsNumbers: string[],
    ancestors: string[],
  ): string | null {
    for (const ancestor of ancestors) {
      if (rulingHtsNumbers.includes(ancestor)) {
        return ancestor;
      }
    }
    return null;
  }

  private firstMatchedTextTerm(
    ruling: CbpCrossRulingEntity,
    terms: string[],
  ): string | undefined {
    const haystack = `${ruling.subject}\n${ruling.rulingText}`.toLowerCase();
    return terms.find((term) => haystack.includes(term.toLowerCase()));
  }

  private bestScore(matches: CrossRulingRetrievalMatch[]): number {
    return Math.max(...matches.map((match) => match.score));
  }

  private rulingDateTime(ruling: CbpCrossRulingEntity): number {
    if (!ruling.rulingDate) {
      return 0;
    }
    const time = new Date(ruling.rulingDate).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  private withRetrievalMetadata(
    ruling: CbpCrossRulingEntity,
    queryHts: string,
    matches: CrossRulingRetrievalMatch[],
  ): CbpCrossRulingEntity {
    ruling.metadata = {
      ...(ruling.metadata || {}),
      reconciliationRetrieval: {
        queryHts,
        bestScore: this.bestScore(matches),
        matches,
        retrievedAt: new Date().toISOString(),
      },
    };
    return ruling;
  }

  private extractHtsNumbers(text: string): string[] {
    return Array.from(
      new Set(
        Array.from(text.matchAll(/\b\d{4}\.\d{2}(?:\.\d{2})?(?:\.\d{2})?\b/g))
          .map((match) => this.normalizeHts(match[0]))
          .filter((value): value is string => !!value),
      ),
    );
  }

  private normalizeHts(value: string | null | undefined): string | null {
    const digits = (value || '').replace(/\D/g, '');
    if (digits.length < 6) {
      return null;
    }
    if (digits.length >= 10) {
      return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}.${digits.slice(8, 10)}`;
    }
    if (digits.length >= 8) {
      return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
    }
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}`;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'hts-service-cross-ingest/1.0',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    return response.json() as Promise<T>;
  }
}
