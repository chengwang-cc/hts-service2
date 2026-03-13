import { Controller, Post, Get, Logger } from '@nestjs/common';
import { RuleCoverageService } from '../services/rule-coverage.service';
import { TestSampleGenerationService } from '../services/test-sample-generation.service';

/**
 * Admin endpoints for triggering and monitoring the two AI-driven background jobs:
 * 1. Rule Coverage Scan: generates new IntentRules for uncovered HTS chapters
 * 2. Test Sample Generation: generates consumer-language query samples per HTS entry
 *
 * Protected by the global JwtAuthGuard — requires a valid JWT token.
 */
@Controller('lookup/jobs')
export class LookupJobController {
  private readonly logger = new Logger(LookupJobController.name);

  constructor(
    private readonly ruleCoverageService: RuleCoverageService,
    private readonly testSampleService: TestSampleGenerationService,
  ) {}

  /**
   * Trigger a full rule coverage scan.
   * Enqueues one pg-boss job per HTS chapter (chapters 01–97).
   * Safe to call multiple times — uses singletonKey to prevent duplicate jobs.
   */
  @Post('coverage-scan')
  async startCoverageScan(): Promise<{ chaptersQueued: number; chapters: string[] }> {
    const chapters = await this.ruleCoverageService.startCoverageScan();
    this.logger.log(`Coverage scan triggered: ${chapters.length} chapters queued`);
    return { chaptersQueued: chapters.length, chapters };
  }

  /**
   * Get status of the rule coverage system.
   */
  @Get('coverage-scan/status')
  async getCoverageScanStatus(): Promise<{
    totalRules: number;
    aiRules: number;
    handcraftedRules: number;
    chapterJobStats: { completed: number; failed: number; pending: number };
  }> {
    return this.ruleCoverageService.getStatus();
  }

  /**
   * Re-queue only chapters whose previous jobs failed.
   * Safe to call multiple times — will only pick up currently-failed jobs.
   */
  @Post('coverage-scan/retry')
  async retryFailedChapters(): Promise<{ chaptersRetried: number; chapters: string[] }> {
    const chapters = await this.ruleCoverageService.retryFailedChapters();
    this.logger.log(`Coverage scan retry triggered: ${chapters.length} chapters re-queued`);
    return { chaptersRetried: chapters.length, chapters };
  }

  /**
   * Trigger test sample generation for all uncovered leaf HTS entries.
   * Enqueues a single coordinator job that fans out into per-entry jobs in the background.
   * Returns immediately — safe to call from HTTP without timeout risk.
   * Safe to call multiple times — uses singletonKey to prevent duplicate coordinator runs.
   */
  @Post('test-samples')
  async startTestSamples(): Promise<{ coordinatorJobQueued: boolean }> {
    const result = await this.testSampleService.triggerSampleGeneration();
    this.logger.log('Test sample generation coordinator job queued');
    return result;
  }

  /**
   * Get progress status of the test sample generation job.
   */
  @Get('test-samples/status')
  async getTestSamplesStatus(): Promise<{
    totalLeafEntries: number;
    entriesWithSamples: number;
    totalSamples: number;
    remaining: number;
  }> {
    return this.testSampleService.getStatus();
  }
}
