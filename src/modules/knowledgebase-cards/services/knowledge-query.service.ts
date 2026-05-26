import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { KnowledgeCardEntity } from '../entities/knowledge-card.entity';
import { KnowledgeSourceEntity } from '../entities/knowledge-source.entity';

/**
 * Read-side query API over knowledge cards + sources. Designed to be
 * called by:
 *   - the public /knowledge endpoints (consumed by hts-ui + partner
 *     integrations);
 *   - the query-builder backend's `planner` (which composes filters
 *     before running an AI synthesis pass).
 *
 * The service intentionally only returns documents that are `active`
 * (or, on opt-in, `pending_review`). Citations always include
 * `sourceFreshnessHours` so the caller can render a "stale" badge.
 */
export interface KnowledgeQueryInput {
  jurisdiction?: string;
  documentType?: string;
  category?: string;
  sourceType?: string;
  cardKey?: string;
  effectiveAfter?: Date;
  effectiveBefore?: Date;
  includePending?: boolean;
  limit?: number;
}

export interface KnowledgeQueryCitation {
  cardId: string;
  cardKey: string;
  documentType: string;
  jurisdiction: string | null;
  sourceUrl: string | null;
  effectiveDate: Date | null;
  contentHash: string;
  status: string;
  sourceFreshnessHours: number | null;
  excerpt: string;
}

export interface KnowledgeQueryResult {
  cards: KnowledgeQueryCitation[];
  sources: Array<{
    id: string;
    name: string;
    publisher: string | null;
    jurisdiction: string | null;
    status: string;
    lastSuccessAt: Date | null;
    freshnessHours: number | null;
  }>;
  generatedAt: string;
}

@Injectable()
export class KnowledgeQueryService {
  private readonly logger = new Logger(KnowledgeQueryService.name);

  constructor(
    @InjectRepository(KnowledgeCardEntity)
    private readonly cards: Repository<KnowledgeCardEntity>,
    @InjectRepository(KnowledgeSourceEntity)
    private readonly sources: Repository<KnowledgeSourceEntity>,
  ) {}

  async query(input: KnowledgeQueryInput): Promise<KnowledgeQueryResult> {
    const limit = Math.max(1, Math.min(100, input.limit ?? 25));
    const qb = this.cards
      .createQueryBuilder('card')
      .orderBy('card.updatedAt', 'DESC')
      .take(limit);
    if (input.includePending) {
      qb.where('card.status IN (:...statuses)', {
        statuses: ['active', 'pending_review'],
      });
    } else {
      qb.where('card.status = :status', { status: 'active' });
    }
    if (input.cardKey) {
      qb.andWhere('card.cardKey = :cardKey', { cardKey: input.cardKey });
    }
    if (input.jurisdiction) {
      qb.andWhere('card.jurisdiction = :jurisdiction', {
        jurisdiction: input.jurisdiction.toUpperCase(),
      });
    }
    if (input.documentType) {
      qb.andWhere('card.documentType = :documentType', {
        documentType: input.documentType,
      });
    }
    if (input.effectiveAfter) {
      qb.andWhere('card.effectiveDate IS NULL OR card.effectiveDate >= :after', {
        after: input.effectiveAfter,
      });
    }
    if (input.effectiveBefore) {
      qb.andWhere('card.effectiveDate IS NULL OR card.effectiveDate <= :before', {
        before: input.effectiveBefore,
      });
    }
    const cardRows = await qb.getMany();

    const sourcesQb = this.sources
      .createQueryBuilder('source')
      .orderBy('source.priority', 'ASC')
      .addOrderBy('source.name', 'ASC');
    if (input.jurisdiction) {
      sourcesQb.where('source.jurisdiction = :jurisdiction', {
        jurisdiction: input.jurisdiction.toUpperCase(),
      });
    }
    if (input.documentType) {
      sourcesQb.andWhere('source.documentType = :documentType', {
        documentType: input.documentType,
      });
    }
    if (input.category) {
      sourcesQb.andWhere('source.category = :category', {
        category: input.category,
      });
    }
    if (input.sourceType) {
      sourcesQb.andWhere('source.sourceType = :sourceType', {
        sourceType: input.sourceType,
      });
    }
    const sourceRows = await sourcesQb.getMany();
    const now = Date.now();
    const sources = sourceRows.map((row) => ({
      id: row.id,
      name: row.name,
      publisher: row.publisher ?? null,
      jurisdiction: row.jurisdiction ?? null,
      status: row.status,
      lastSuccessAt: row.lastSuccessAt ?? null,
      freshnessHours: row.lastSuccessAt
        ? Math.round((now - row.lastSuccessAt.getTime()) / 3_600_000)
        : null,
    }));

    return {
      cards: cardRows.map((c) => this.toCitation(c, sources)),
      sources,
      generatedAt: new Date().toISOString(),
    };
  }

  private toCitation(
    card: KnowledgeCardEntity,
    sources: KnowledgeQueryResult['sources'],
  ): KnowledgeQueryCitation {
    const source = card.sourceUrl
      ? sources.find((s) => card.sourceUrl?.startsWith(s.name) || false)
      : undefined;
    const text = ((card.payload as any)?.text ?? '') as string;
    const excerpt = text.length <= 240 ? text : `${text.slice(0, 240)}…`;
    return {
      cardId: card.id,
      cardKey: card.cardKey,
      documentType: card.documentType,
      jurisdiction: card.jurisdiction,
      sourceUrl: card.sourceUrl,
      effectiveDate: card.effectiveDate,
      contentHash: card.contentHash,
      status: card.status,
      sourceFreshnessHours: source?.freshnessHours ?? null,
      excerpt,
    };
  }
}
