import { Injectable, Logger, Optional } from '@nestjs/common';
import { KnowledgeCardIngestionService } from '../services/knowledge-card-ingestion.service';
import { RssFeedReaderService } from '../services/rss-feed-reader.service';
import { KnowledgeSourceRegistryService } from '../services/knowledge-source-registry.service';
import {
  DEFAULT_SOURCE_FEEDS,
  SourceFeed,
} from '../services/knowledge-source.types';

/**
 * SourceMonitorJob (Phase 8, P8.T14; Phase 10 RSS upgrade).
 *
 * Polls authoritative source feeds — when a feed is an RSS / Atom feed
 * (the default for CBP CSMS, Federal Register, EU OJ), the job parses
 * the feed and queues each NEW item URL for ingestion. When the feed
 * is a plain HTML landing page (`asRssFeed: false`), the job ingests
 * the page URL directly as a single document — useful for static pages
 * like the EU CBAM overview.
 *
 * Idempotency:
 *   The ingestion pipeline upserts cards by content hash; the job can
 *   safely re-poll the same feed and re-fetch the same items. New
 *   content produces a `pending_review` card + alerts.
 *
 * Activation: a `SchedulerModule` cron registers this job at boot when
 * `KNOWLEDGE_SOURCE_MONITOR_ENABLED=true`.
 */
export interface SourceMonitorRunResult {
  attempted: number;
  succeeded: number;
  failed: number;
  partial: number;
  results: Array<{
    name: string;
    outcome: string;
    status?: 'succeeded' | 'partial' | 'failed';
    itemsProcessed?: number;
    itemsSkipped?: number;
    itemsFailed?: number;
    sourceId?: string;
    runId?: string;
  }>;
}

export interface SourceMonitorRunOptions {
  sourceId?: string | null;
  force?: boolean;
  trigger?: string | null;
  jobId?: string | null;
}

@Injectable()
export class SourceMonitorJob {
  private readonly logger = new Logger(SourceMonitorJob.name);

  constructor(
    private readonly ingest: KnowledgeCardIngestionService,
    private readonly rss: RssFeedReaderService,
    @Optional()
    private readonly registry?: KnowledgeSourceRegistryService,
  ) {}

  /**
   * Single pass over the configured feeds. Each fetch is independent
   * — one failure does not block the others.
   */
  async runOnce(
    input?: readonly SourceFeed[] | SourceMonitorRunOptions,
  ): Promise<SourceMonitorRunResult> {
    const explicitFeeds = Array.isArray(input) ? input : null;
    const options: SourceMonitorRunOptions = explicitFeeds
      ? {}
      : ((input as SourceMonitorRunOptions | undefined) ?? {});
    const feeds = explicitFeeds ?? (await this.resolveFeeds(options));
    const results: SourceMonitorRunResult['results'] = [];
    let succeeded = 0;
    let failed = 0;
    let partial = 0;
    for (const feed of feeds) {
      const run = await this.registry?.beginRun({
        sourceId: feed.sourceId ?? null,
        trigger: options.trigger ?? 'source-monitor',
        jobId: options.jobId ?? null,
      });
      let attemptedItems = 0;
      let succeededItems = 0;
      let failedItems = 0;
      let skippedItems = 0;
      let discoveredItems = 0;
      try {
        const asRss = feed.asRssFeed !== false;
        if (asRss) {
          const items = await this.rss.fetchFeed(feed.url, feed.itemLimit ?? 25);
          for (const item of items) {
            attemptedItems += 1;
            const ledgerItem = await this.registry?.recordItemSeen(feed, item);
            if (this.registry?.shouldSkipItem(ledgerItem ?? null, options.force === true)) {
              skippedItems += 1;
              await this.registry.recordItemSkipped(
                ledgerItem ?? null,
                'already_ingested',
              );
              continue;
            }
            try {
              const ingestResult = await this.ingest.ingestUrl({
                url: item.url,
                hint: feed.hint,
                ingestedBy: `source-monitor:${feed.name}|item:${item.title ?? item.url}`,
              });
              await this.registry?.recordItemIngested(
                ledgerItem ?? null,
                ingestResult.upsert,
              );
              succeededItems += 1;
              discoveredItems += 1;
            } catch (e: any) {
              failedItems += 1;
              await this.registry?.recordItemFailed(ledgerItem ?? null, e);
              this.logger.warn(
                `source-monitor item "${item.url}" failed: ${e?.message ?? e}`,
              );
            }
          }
          const status: 'succeeded' | 'partial' | 'failed' =
            failedItems > 0 && succeededItems === 0
              ? 'failed'
              : failedItems > 0
                ? 'partial'
                : 'succeeded';
          // Only mark source success when at least one item ingested.
          // A wholly-failed RSS pass leaves the source's lastSuccessAt
          // untouched and reports as a source failure to the operator.
          if (status === 'failed') {
            await this.registry?.markSourceFailure(
              feed,
              new Error(
                `all ${attemptedItems} RSS items failed for source "${feed.name}"`,
              ),
            );
          } else {
            await this.registry?.markSourceSuccess(feed, { discoveredItems });
          }
          await this.registry?.finishRun(run ?? null, {
            status,
            attemptedItems,
            succeededItems,
            failedItems,
            resultJson: {
              itemCount: items.length,
              skippedItems,
              sourceUrl: feed.url,
              partial: status === 'partial',
            },
            errorMessage:
              status === 'failed'
                ? `all ${attemptedItems} RSS items failed`
                : undefined,
          });
          results.push({
            name: feed.name,
            outcome:
              status === 'failed'
                ? `rss: all ${attemptedItems} items failed`
                : `rss: ${succeededItems}/${items.length} items ingested${status === 'partial' ? ` (${failedItems} failed)` : ''}`,
            status,
            itemsProcessed: succeededItems,
            itemsSkipped: skippedItems,
            itemsFailed: failedItems,
            sourceId: feed.sourceId,
            runId: run?.id,
          });
          if (status === 'succeeded') succeeded += 1;
          else if (status === 'partial') partial += 1;
          else failed += 1;
        } else {
          attemptedItems = 1;
          const ledgerItem = await this.registry?.recordItemSeen(feed, {
            url: feed.url,
            title: feed.name,
          });
          if (this.registry?.shouldSkipItem(ledgerItem ?? null, options.force === true)) {
            skippedItems = 1;
            await this.registry.recordItemSkipped(
              ledgerItem ?? null,
              'already_ingested',
            );
          } else {
            const r = await this.ingest.ingestUrl({
              url: feed.url,
              hint: feed.hint,
              ingestedBy: `source-monitor:${feed.name}`,
            });
            await this.registry?.recordItemIngested(
              ledgerItem ?? null,
              r.upsert,
            );
            succeededItems = 1;
            discoveredItems = 1;
          }
          await this.registry?.markSourceSuccess(feed, { discoveredItems });
          await this.registry?.finishRun(run ?? null, {
            status: 'succeeded',
            attemptedItems,
            succeededItems,
            failedItems,
            resultJson: {
              skippedItems,
              sourceUrl: feed.url,
            },
          });
          results.push({
            name: feed.name,
            outcome: skippedItems ? 'skipped: already ingested' : 'ingested',
            status: 'succeeded',
            itemsProcessed: succeededItems,
            itemsSkipped: skippedItems,
            itemsFailed: 0,
            sourceId: feed.sourceId,
            runId: run?.id,
          });
          succeeded += 1;
        }
      } catch (e: any) {
        failed += 1;
        failedItems = attemptedItems === 0 ? 1 : failedItems || 1;
        await this.registry?.markSourceFailure(feed, e);
        await this.registry?.finishRun(run ?? null, {
          status: 'failed',
          attemptedItems,
          succeededItems,
          failedItems,
          resultJson: { sourceUrl: feed.url },
          errorMessage: e?.message ?? String(e),
        });
        results.push({
          name: feed.name,
          outcome: `error: ${e?.message ?? e}`,
          status: 'failed',
          itemsFailed: failedItems,
          sourceId: feed.sourceId,
          runId: run?.id,
        });
        this.logger.warn(`source-monitor "${feed.name}" failed: ${e?.message ?? e}`);
      }
    }
    this.logger.log(
      `source-monitor pass complete: attempted=${feeds.length} succeeded=${succeeded} partial=${partial} failed=${failed}`,
    );
    return { attempted: feeds.length, succeeded, partial, failed, results };
  }

  async runFromQueue(data: Record<string, unknown> | undefined): Promise<SourceMonitorRunResult> {
    return this.runOnce({
      sourceId: typeof data?.sourceId === 'string' ? data.sourceId : null,
      force: data?.force === true,
      trigger: typeof data?.trigger === 'string' ? data.trigger : 'queue',
      jobId: typeof data?.jobId === 'string' ? data.jobId : null,
    });
  }

  private async resolveFeeds(options: SourceMonitorRunOptions): Promise<SourceFeed[]> {
    if (this.registry) {
      return this.registry.resolveFeeds({
        sourceId: options.sourceId ?? null,
        seedDefaultsWhenEmpty: true,
      });
    }
    return [...DEFAULT_SOURCE_FEEDS];
  }
}
