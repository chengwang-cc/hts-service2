import { SourceMonitorJob } from './source-monitor.job';
import type { SourceFeed } from '../services/knowledge-source.types';

describe('SourceMonitorJob', () => {
  const feed: SourceFeed = {
    sourceId: 'source-1',
    name: 'CBP CSMS',
    url: 'https://example.gov/feed.rss',
    sourceType: 'rss',
    asRssFeed: true,
    itemLimit: 10,
    hint: { jurisdiction: 'US', documentType: 'csms' },
  };

  function build(overrides: Record<string, unknown> = {}) {
    const ingest = {
      ingestUrl: jest.fn(async () => ({
        upsert: {
          outcome: 'inserted',
          card: { id: 'card-1', contentHash: 'hash-1' },
        },
      })),
    };
    const rss = {
      fetchFeed: jest.fn(async () => [
        { url: 'https://example.gov/item-1', title: 'Item 1' },
      ]),
    };
    const registry = {
      resolveFeeds: jest.fn(async () => [feed]),
      beginRun: jest.fn(async () => ({ id: 'run-1' })),
      recordItemSeen: jest.fn(async () => ({
        id: 'item-1',
        status: 'discovered',
        lastIngestedAt: null,
      })),
      shouldSkipItem: jest.fn(() => false),
      recordItemSkipped: jest.fn(),
      recordItemIngested: jest.fn(),
      recordItemFailed: jest.fn(),
      markSourceSuccess: jest.fn(),
      markSourceFailure: jest.fn(),
      finishRun: jest.fn(),
      ...overrides,
    };
    return {
      ingest,
      rss,
      registry,
      job: new SourceMonitorJob(ingest as any, rss as any, registry as any),
    };
  }

  it('resolves persisted sources and records crawl runs/items', async () => {
    const { job, ingest, rss, registry } = build();

    const result = await job.runOnce({ sourceId: 'source-1', trigger: 'test' });

    expect(registry.resolveFeeds).toHaveBeenCalledWith({
      sourceId: 'source-1',
      seedDefaultsWhenEmpty: true,
    });
    expect(registry.beginRun).toHaveBeenCalledWith({
      sourceId: 'source-1',
      trigger: 'test',
      jobId: null,
    });
    expect(rss.fetchFeed).toHaveBeenCalledWith(feed.url, 10);
    expect(ingest.ingestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.gov/item-1',
        hint: feed.hint,
      }),
    );
    expect(registry.recordItemIngested).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      expect.objectContaining({ outcome: 'inserted' }),
    );
    expect(registry.finishRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1' }),
      expect.objectContaining({
        status: 'succeeded',
        attemptedItems: 1,
        succeededItems: 1,
        failedItems: 0,
      }),
    );
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        sourceId: 'source-1',
        runId: 'run-1',
        itemsProcessed: 1,
      }),
    );
  });

  it('marks the source as failed when every RSS item fails (regression for H4)', async () => {
    const { job, registry } = build({});
    registry.recordItemSeen = jest.fn(async () => ({
      id: 'item-1',
      status: 'discovered',
      lastIngestedAt: null,
    }));
    registry.shouldSkipItem = jest.fn(() => false);
    const ingestFail = jest.fn(async () => {
      throw new Error('upstream 503');
    });
    const job2 = new SourceMonitorJob(
      { ingestUrl: ingestFail } as any,
      {
        fetchFeed: jest.fn(async () => [
          { url: 'https://example.gov/item-1', title: 'Item 1' },
          { url: 'https://example.gov/item-2', title: 'Item 2' },
        ]),
      } as any,
      registry as any,
    );

    const result = await job2.runOnce({ sourceId: 'source-1' });

    expect(registry.markSourceSuccess).not.toHaveBeenCalled();
    expect(registry.markSourceFailure).toHaveBeenCalled();
    expect(registry.finishRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1' }),
      expect.objectContaining({ status: 'failed', failedItems: 2 }),
    );
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.results[0].status).toBe('failed');
  });

  it('reports partial when some items succeed and some fail', async () => {
    const registry = {
      resolveFeeds: jest.fn(async () => [feed]),
      beginRun: jest.fn(async () => ({ id: 'run-1' })),
      recordItemSeen: jest.fn(async () => ({
        id: 'item-1',
        status: 'discovered',
        lastIngestedAt: null,
      })),
      shouldSkipItem: jest.fn(() => false),
      recordItemSkipped: jest.fn(),
      recordItemIngested: jest.fn(),
      recordItemFailed: jest.fn(),
      markSourceSuccess: jest.fn(),
      markSourceFailure: jest.fn(),
      finishRun: jest.fn(),
    };
    let call = 0;
    const ingest = {
      ingestUrl: jest.fn(async () => {
        call += 1;
        if (call === 2) throw new Error('partial-fail');
        return {
          upsert: {
            outcome: 'inserted',
            card: { id: 'card-1', contentHash: 'h' },
          },
        };
      }),
    };
    const rss = {
      fetchFeed: jest.fn(async () => [
        { url: 'https://example.gov/a', title: 'a' },
        { url: 'https://example.gov/b', title: 'b' },
      ]),
    };
    const job2 = new SourceMonitorJob(
      ingest as any,
      rss as any,
      registry as any,
    );
    const result = await job2.runOnce({ sourceId: 'source-1' });

    expect(registry.markSourceSuccess).toHaveBeenCalled();
    expect(registry.finishRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1' }),
      expect.objectContaining({ status: 'partial' }),
    );
    expect(result.partial).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].status).toBe('partial');
  });

  it('skips previously ingested items unless forced', async () => {
    const { job, ingest, registry } = build({
      recordItemSeen: jest.fn(async () => ({
        id: 'item-1',
        status: 'ingested',
        lastIngestedAt: new Date(),
      })),
      shouldSkipItem: jest.fn(() => true),
    });

    const result = await job.runOnce({ sourceId: 'source-1' });

    expect(ingest.ingestUrl).not.toHaveBeenCalled();
    expect(registry.recordItemSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      'already_ingested',
    );
    expect(result.results[0]).toEqual(
      expect.objectContaining({ itemsProcessed: 0, itemsSkipped: 1 }),
    );
  });
});
