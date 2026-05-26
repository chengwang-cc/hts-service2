import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { TelemetryService } from '../../observability/telemetry.service';
import {
  KnowledgeSourceCrawlRunEntity,
  KnowledgeSourceEntity,
  KnowledgeSourceItemEntity,
} from '../entities';
import {
  CreateKnowledgeSourceDto,
  UpdateKnowledgeSourceDto,
} from '../dto/knowledge-source.dto';
import {
  DEFAULT_SOURCE_FEEDS,
  SourceFeed,
} from './knowledge-source.types';
import type { FeedItem } from './rss-feed-reader.service';
import type { CardUpsertResult } from './knowledge-card.service';

export interface ResolveSourceFeedsOptions {
  sourceId?: string | null;
  seedDefaultsWhenEmpty?: boolean;
}

@Injectable()
export class KnowledgeSourceRegistryService {
  constructor(
    @InjectRepository(KnowledgeSourceEntity)
    private readonly sources: Repository<KnowledgeSourceEntity>,
    @InjectRepository(KnowledgeSourceItemEntity)
    private readonly items: Repository<KnowledgeSourceItemEntity>,
    @InjectRepository(KnowledgeSourceCrawlRunEntity)
    private readonly runs: Repository<KnowledgeSourceCrawlRunEntity>,
    @Optional()
    private readonly audit: AuditService | null = null,
    @Optional()
    private readonly telemetry: TelemetryService | null = null,
  ) {}

  private async auditRecord(
    eventType: string,
    actor: string,
    sourceId: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.audit) return;
    await this.audit.record({
      eventType,
      actorUserId: actor,
      resourceType: 'knowledge_source',
      resourceId: sourceId,
      source: 'knowledge-source-registry',
      metadata,
    });
  }

  async list(filter: {
    status?: string;
    sourceType?: string;
  } = {}): Promise<KnowledgeSourceEntity[]> {
    return this.sources.find({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.sourceType ? { sourceType: filter.sourceType } : {}),
      },
      order: { priority: 'ASC', name: 'ASC' },
    });
  }

  async listItems(sourceId: string, limit = 100): Promise<KnowledgeSourceItemEntity[]> {
    await this.requireSource(sourceId);
    return this.items.find({
      where: { sourceId },
      order: { lastSeenAt: 'DESC', createdAt: 'DESC' },
      take: Math.max(1, Math.min(250, limit)),
    });
  }

  async listRuns(sourceId?: string, limit = 100): Promise<KnowledgeSourceCrawlRunEntity[]> {
    return this.runs.find({
      where: sourceId ? { sourceId } : {},
      order: { startedAt: 'DESC' },
      take: Math.max(1, Math.min(250, limit)),
    });
  }

  async create(
    input: CreateKnowledgeSourceDto,
    actor = 'system',
  ): Promise<KnowledgeSourceEntity> {
    const existing = await this.sources.findOne({ where: { url: input.url } });
    if (existing) {
      throw new ConflictException(`knowledge source already exists for URL: ${input.url}`);
    }

    const now = new Date();
    const source = this.sources.create({
      name: input.name,
      publisher: input.publisher ?? null,
      sourceType: input.sourceType,
      url: input.url,
      jurisdiction: input.jurisdiction ?? null,
      documentType: input.documentType ?? null,
      category: input.category ?? null,
      trustTier: input.trustTier ?? 'official',
      status: input.status ?? 'active',
      crawlFrequencyHours: input.crawlFrequencyHours ?? 6,
      itemLimit: input.itemLimit ?? 25,
      priority: input.priority ?? 100,
      respectRobots: input.respectRobots ?? true,
      requiresReview: input.requiresReview ?? true,
      metadata: input.metadata ?? null,
      lastCrawledAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastDiscoveredAt: null,
      lastErrorMessage: null,
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    } as KnowledgeSourceEntity);
    const saved = await this.sources.save(source);
    await this.auditRecord('knowledge_source.created', actor, saved.id, {
      name: saved.name,
      url: saved.url,
      jurisdiction: saved.jurisdiction,
      sourceType: saved.sourceType,
    });
    return saved;
  }

  async update(
    id: string,
    input: UpdateKnowledgeSourceDto,
    actor = 'system',
  ): Promise<KnowledgeSourceEntity> {
    const source = await this.requireSource(id);
    if (input.url && input.url !== source.url) {
      const existing = await this.sources.findOne({ where: { url: input.url } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`knowledge source already exists for URL: ${input.url}`);
      }
    }

    Object.assign(source, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.publisher !== undefined ? { publisher: input.publisher ?? null } : {}),
      ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction ?? null } : {}),
      ...(input.documentType !== undefined ? { documentType: input.documentType ?? null } : {}),
      ...(input.category !== undefined ? { category: input.category ?? null } : {}),
      ...(input.trustTier !== undefined ? { trustTier: input.trustTier } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.crawlFrequencyHours !== undefined
        ? { crawlFrequencyHours: input.crawlFrequencyHours }
        : {}),
      ...(input.itemLimit !== undefined ? { itemLimit: input.itemLimit } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.respectRobots !== undefined ? { respectRobots: input.respectRobots } : {}),
      ...(input.requiresReview !== undefined ? { requiresReview: input.requiresReview } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata ?? null } : {}),
      updatedBy: actor,
    });

    const saved = await this.sources.save(source);
    await this.auditRecord('knowledge_source.updated', actor, saved.id, {
      changedKeys: Object.keys(input ?? {}),
    });
    return saved;
  }

  async seedDefaultSources(actor = 'system'): Promise<KnowledgeSourceEntity[]> {
    const saved: KnowledgeSourceEntity[] = [];
    let priority = 100;
    for (const feed of DEFAULT_SOURCE_FEEDS) {
      const existing = await this.sources.findOne({ where: { url: feed.url } });
      if (existing) {
        saved.push(existing);
        continue;
      }

      const metadata = feed.metadata ?? {};
      const source = this.sources.create({
        name: feed.name,
        publisher: readString(metadata.publisher),
        sourceType: feed.sourceType ?? (feed.asRssFeed === false ? 'html' : 'rss'),
        url: feed.url,
        jurisdiction: feed.hint?.jurisdiction ?? null,
        documentType: feed.hint?.documentType ?? null,
        category: readString(metadata.category),
        trustTier: readString(metadata.trustTier) ?? 'official',
        status: 'active',
        crawlFrequencyHours: 6,
        itemLimit: feed.itemLimit ?? 25,
        priority,
        respectRobots: true,
        requiresReview: feed.requiresReview ?? true,
        metadata,
        lastCrawledAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastDiscoveredAt: null,
        lastErrorMessage: null,
        createdBy: actor,
        updatedBy: actor,
      } as KnowledgeSourceEntity);
      saved.push(await this.sources.save(source));
      priority += 10;
    }
    return saved;
  }

  async resolveFeeds(
    options: ResolveSourceFeedsOptions = {},
  ): Promise<SourceFeed[]> {
    if (options.sourceId) {
      const source = await this.requireSource(options.sourceId);
      if (source.status !== 'active') {
        throw new BadRequestException(
          `knowledge source ${source.id} is ${source.status}, not active`,
        );
      }
      return [this.toFeed(source)];
    }

    let active = await this.sources.find({
      where: { status: 'active' },
      order: { priority: 'ASC', name: 'ASC' },
    });
    if (active.length === 0 && options.seedDefaultsWhenEmpty !== false) {
      await this.seedDefaultSources();
      active = await this.sources.find({
        where: { status: 'active' },
        order: { priority: 'ASC', name: 'ASC' },
      });
    }
    return active.map((source) => this.toFeed(source));
  }

  async requireSource(id: string): Promise<KnowledgeSourceEntity> {
    const source = await this.sources.findOne({ where: { id } });
    if (!source) {
      throw new NotFoundException(`knowledge source not found: ${id}`);
    }
    return source;
  }

  async beginRun(input: {
    sourceId?: string | null;
    trigger?: string | null;
    jobId?: string | null;
  }): Promise<KnowledgeSourceCrawlRunEntity> {
    const run = this.runs.create({
      sourceId: input.sourceId ?? null,
      status: 'running',
      trigger: input.trigger ?? null,
      jobId: input.jobId ?? null,
      attemptedItems: 0,
      succeededItems: 0,
      failedItems: 0,
      resultJson: null,
      errorMessage: null,
      finishedAt: null,
    } as KnowledgeSourceCrawlRunEntity);
    return this.runs.save(run);
  }

  async finishRun(
    run: KnowledgeSourceCrawlRunEntity | null,
    result: {
      status: 'succeeded' | 'partial' | 'failed';
      attemptedItems: number;
      succeededItems: number;
      failedItems: number;
      resultJson?: Record<string, unknown> | null;
      errorMessage?: string | null;
    },
  ): Promise<void> {
    if (!run) return;
    run.status = result.status;
    run.attemptedItems = result.attemptedItems;
    run.succeededItems = result.succeededItems;
    run.failedItems = result.failedItems;
    run.resultJson = result.resultJson ?? null;
    run.errorMessage = result.errorMessage ?? null;
    run.finishedAt = new Date();
    await this.runs.save(run);
    this.telemetry?.countEvent('knowledge_source_crawl_runs_total', {
      status: run.status,
    });
  }

  async recordItemSeen(
    feed: SourceFeed,
    item: FeedItem,
  ): Promise<KnowledgeSourceItemEntity | null> {
    if (!feed.sourceId) return null;
    const now = new Date();
    const existing = await this.items.findOne({
      where: { sourceId: feed.sourceId, url: item.url },
    });
    if (existing) {
      existing.title = item.title ?? existing.title;
      existing.publishedAt = item.publishedAt ?? existing.publishedAt;
      existing.lastSeenAt = now;
      existing.errorMessage = null;
      if (existing.status === 'error') {
        existing.status = 'discovered';
      }
      return this.items.save(existing);
    }

    const row = this.items.create({
      sourceId: feed.sourceId,
      url: item.url,
      title: item.title ?? null,
      publishedAt: item.publishedAt ?? null,
      status: 'discovered',
      knowledgeCardId: null,
      contentHash: null,
      firstSeenAt: now,
      lastSeenAt: now,
      lastIngestedAt: null,
      errorMessage: null,
      metadata: null,
    } as KnowledgeSourceItemEntity);
    return this.items.save(row);
  }

  shouldSkipItem(
    item: KnowledgeSourceItemEntity | null,
    force: boolean,
  ): boolean {
    return (
      !force &&
      !!item?.lastIngestedAt &&
      (item.status === 'ingested' || item.status === 'skipped')
    );
  }

  async recordItemIngested(
    item: KnowledgeSourceItemEntity | null,
    result: CardUpsertResult,
  ): Promise<void> {
    if (!item) return;
    item.status = 'ingested';
    item.knowledgeCardId = result.card.id;
    item.contentHash = result.card.contentHash;
    item.lastIngestedAt = new Date();
    item.errorMessage = null;
    item.metadata = {
      ...(item.metadata ?? {}),
      lastUpsertOutcome: result.outcome,
    };
    await this.items.save(item);
  }

  async recordItemSkipped(
    item: KnowledgeSourceItemEntity | null,
    reason: string,
  ): Promise<void> {
    if (!item) return;
    if (reason !== 'already_ingested') {
      item.status = 'skipped';
    }
    item.metadata = { ...(item.metadata ?? {}), lastSkipReason: reason };
    await this.items.save(item);
  }

  async recordItemFailed(
    item: KnowledgeSourceItemEntity | null,
    error: unknown,
  ): Promise<void> {
    if (!item) return;
    item.status = 'error';
    item.errorMessage = errorMessage(error);
    await this.items.save(item);
  }

  async markSourceSuccess(
    feed: SourceFeed,
    counters: { discoveredItems: number },
  ): Promise<void> {
    if (!feed.sourceId) return;
    const source = await this.sources.findOne({ where: { id: feed.sourceId } });
    if (!source) return;
    const now = new Date();
    source.lastCrawledAt = now;
    source.lastSuccessAt = now;
    source.lastErrorMessage = null;
    if (source.status === 'error') {
      source.status = 'active';
    }
    if (counters.discoveredItems > 0) {
      source.lastDiscoveredAt = now;
    }
    await this.sources.save(source);
    this.telemetry?.setGauge(
      'knowledge_source_last_success_timestamp',
      {
        name: source.name,
        trust_tier: source.trustTier ?? 'unknown',
      },
      Math.floor(now.getTime() / 1000),
    );
  }

  async markSourceFailure(feed: SourceFeed, error: unknown): Promise<void> {
    if (!feed.sourceId) return;
    const source = await this.sources.findOne({ where: { id: feed.sourceId } });
    if (!source) return;
    const now = new Date();
    source.lastCrawledAt = now;
    source.lastFailureAt = now;
    source.lastErrorMessage = errorMessage(error);
    await this.sources.save(source);
  }

  private toFeed(source: KnowledgeSourceEntity): SourceFeed {
    return {
      sourceId: source.id,
      name: source.name,
      url: source.url,
      sourceType: source.sourceType,
      asRssFeed: source.sourceType === 'rss',
      itemLimit: source.itemLimit,
      hint: {
        jurisdiction: source.jurisdiction ?? undefined,
        documentType: source.documentType ?? undefined,
      },
      metadata: {
        ...(source.metadata ?? {}),
        publisher: source.publisher ?? undefined,
        category: source.category ?? undefined,
        trustTier: source.trustTier,
        crawlFrequencyHours: source.crawlFrequencyHours,
      },
      requiresReview: source.requiresReview,
    };
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}
