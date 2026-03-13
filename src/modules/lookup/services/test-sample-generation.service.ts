import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '@hts/core';
import { AnthropicService } from '../../../core/services/anthropic.service';
import { QueueService } from '../../queue/queue.service';
import { LookupTestSampleEntity } from '../entities/lookup-test-sample.entity';

export const TEST_SAMPLE_ENTRY_QUEUE = 'test-sample-entry';
/** Single coordinator job that fans out into per-entry jobs in the background. */
export const TEST_SAMPLE_COORDINATOR_QUEUE = 'test-sample-coordinator';

export interface TestSampleJobData {
  htsNumber: string;
  description: string;
  fullDescription: string[] | null;
  chapter: string;
}

@Injectable()
export class TestSampleGenerationService {
  private readonly logger = new Logger(TestSampleGenerationService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepo: Repository<HtsEntity>,
    @InjectRepository(LookupTestSampleEntity)
    private readonly sampleRepo: Repository<LookupTestSampleEntity>,
    private readonly anthropicService: AnthropicService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Trigger: enqueues a single coordinator job that fans out into per-entry jobs.
   * Returns immediately — the HTTP request will not time out even with 17K entries.
   * Safe to call multiple times: the coordinator uses singletonKey to prevent
   * duplicate coordinator runs.
   */
  async triggerSampleGeneration(): Promise<{ coordinatorJobQueued: boolean }> {
    await this.queueService.sendJob(
      TEST_SAMPLE_COORDINATOR_QUEUE,
      {},
      { singletonKey: 'test-sample-coordinator' },
    );
    this.logger.log('Test sample coordinator job enqueued');
    return { coordinatorJobQueued: true };
  }

  /**
   * Coordinator handler (runs inside pg-boss, not in the HTTP request cycle).
   * Scans all leaf HTS entries and enqueues one per-entry job for each
   * entry that does not yet have 10 samples.
   */
  async runCoordinator(): Promise<void> {
    this.logger.log('Test sample coordinator starting...');

    // Load all classifiable leaf entries
    const allLeafs = await this.htsRepo.find({
      where: { isActive: true, hasChildren: false },
      select: {
        htsNumber: true,
        description: true,
        fullDescription: true,
        chapter: true,
      },
    });

    // Filter to chapters 01–97 and 10-digit HTS numbers only
    const leafEntries = allLeafs.filter(
      (e) =>
        e.chapter !== '98' &&
        e.chapter !== '99' &&
        e.htsNumber.replace(/\./g, '').length === 10,
    );

    // Find entries that already have >= 10 samples
    const coveredRows = await this.sampleRepo
      .createQueryBuilder('s')
      .select('s.htsNumber', 'htsNumber')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('s.htsNumber')
      .having('COUNT(*) >= 10')
      .getRawMany<{ htsNumber: string; cnt: string }>();

    const coveredSet = new Set(coveredRows.map((r) => r.htsNumber));
    const toProcess = leafEntries.filter((e) => !coveredSet.has(e.htsNumber));

    this.logger.log(
      `Coordinator: ${toProcess.length} entries to process ` +
        `(${coveredSet.size} already covered, ${leafEntries.length} total leaf entries)`,
    );

    for (const entry of toProcess) {
      await this.queueService.sendJob(
        TEST_SAMPLE_ENTRY_QUEUE,
        {
          htsNumber: entry.htsNumber,
          description: entry.description,
          fullDescription: entry.fullDescription,
          chapter: entry.chapter,
        } satisfies TestSampleJobData,
        {
          singletonKey: `test-sample-${entry.htsNumber.replace(/\./g, '_')}`,
          retryLimit: 3,
          retryDelay: 15,
          retryBackoff: true,
        },
      );
    }

    this.logger.log(`Coordinator: finished enqueuing ${toProcess.length} test-sample jobs`);
  }

  /**
   * Job handler: generate 10 consumer-language search queries for one HTS entry
   * and persist them to lookup_test_sample.
   */
  async processEntry(data: TestSampleJobData): Promise<void> {
    const { htsNumber, description, fullDescription, chapter } = data;

    // Re-check sample count to guard against duplicate jobs
    const existingCount = await this.sampleRepo.count({
      where: { htsNumber },
    });
    if (existingCount >= 10) {
      this.logger.debug(`${htsNumber}: already has ${existingCount} samples, skipping`);
      return;
    }

    const categoryPath =
      fullDescription && fullDescription.length > 0
        ? fullDescription.slice(-4).join(' > ')
        : description;

    const prompt = `You are creating search query test data for an HTS (US customs tariff) classification system.

HTS CODE: ${htsNumber}
OFFICIAL DESCRIPTION: ${description}
CATEGORY PATH: ${categoryPath}
CHAPTER: ${chapter}

Generate exactly 10 diverse search queries a real importer or buyer might type to find this specific product. Think like a real person shopping or importing goods — NOT a customs official.

REQUIREMENTS:
- Use everyday product language; never copy the official HTS description verbatim
- Never include HTS codes, chapter numbers, or legal tariff terminology
- Vary query lengths: 2 very short (1-2 words), 4 medium (3-4 words), 4 longer/specific (5+ words)
- Cover different angles: materials, use cases, brand-neutral product names, common synonyms
- Include at least 1 informal or colloquial term if it's natural for this product

RETURN: A JSON array of exactly 10 strings. No other text, no markdown.`;

    let queries: string[];
    try {
      queries = await this.anthropicService.completeJson<string[]>(prompt, {
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 512,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('JSON') || msg.includes('parse') || msg.includes('Unexpected')) {
        this.logger.error(`${htsNumber}: Claude returned invalid JSON, skipping. ${msg}`);
        return;
      }
      throw err; // Transient — pg-boss will retry
    }

    if (!Array.isArray(queries)) {
      this.logger.warn(`${htsNumber}: Claude returned non-array, skipping`);
      return;
    }

    // Filter to valid non-empty strings
    const validQueries = queries
      .filter((q) => typeof q === 'string' && q.trim().length > 0)
      .slice(0, 10)
      .map((q) => q.trim());

    if (validQueries.length === 0) {
      this.logger.warn(`${htsNumber}: no valid queries generated`);
      return;
    }

    // How many more do we need?
    const needed = 10 - existingCount;
    const toInsert = validQueries.slice(0, needed);

    await this.sampleRepo.save(
      toInsert.map((query) =>
        this.sampleRepo.create({
          htsNumber,
          query,
          source: 'claude-haiku',
        }),
      ),
    );

    this.logger.debug(`${htsNumber}: saved ${toInsert.length} sample queries`);
  }

  /** Progress status for the sample generation job. */
  async getStatus(): Promise<{
    totalLeafEntries: number;
    entriesWithSamples: number;
    totalSamples: number;
    remaining: number;
  }> {
    const [totalLeafEntries, entriesWithSamples, totalSamples] = await Promise.all([
      this.htsRepo
        .createQueryBuilder('hts')
        .where('hts.isActive = :active', { active: true })
        .andWhere('hts.hasChildren = :hasChildren', { hasChildren: false })
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
        .getCount(),
      this.sampleRepo
        .createQueryBuilder('s')
        .select('COUNT(DISTINCT s.htsNumber)', 'cnt')
        .getRawOne<{ cnt: string }>()
        .then((r) => parseInt(r?.cnt ?? '0', 10)),
      this.sampleRepo.count(),
    ]);

    return {
      totalLeafEntries,
      entriesWithSamples,
      totalSamples,
      remaining: Math.max(0, totalLeafEntries - entriesWithSamples),
    };
  }
}
