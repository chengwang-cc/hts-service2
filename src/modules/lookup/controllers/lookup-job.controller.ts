import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { RuleCoverageService } from '../services/rule-coverage.service';
import { TestSampleGenerationService } from '../services/test-sample-generation.service';
import { LookupDatasetCurationJobService } from '../services/lookup-dataset-curation-job.service';
import { LookupDatasetCurationJobDto } from '../dto/lookup-dataset-curation-job.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

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
    private readonly lookupDatasetCurationJobService: LookupDatasetCurationJobService,
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

  @Post('dataset-curation')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (
          !file.originalname.match(/\.csv$/i) &&
          file.mimetype !== 'text/csv' &&
          file.mimetype !== 'application/vnd.ms-excel'
        ) {
          return cb(new BadRequestException('Only CSV files are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  async createDatasetCurationJob(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: LookupDatasetCurationJobDto,
  ) {
    return this.lookupDatasetCurationJobService.createJob(user, file, dto);
  }

  @Get('dataset-curation/:jobId')
  async getDatasetCurationJob(
    @CurrentUser() user: any,
    @Param('jobId') jobId: string,
  ) {
    return this.lookupDatasetCurationJobService.getJob(jobId, user.organizationId);
  }

  @Get('dataset-curation/:jobId/artifacts/:artifact')
  async downloadDatasetCurationArtifact(
    @CurrentUser() user: any,
    @Param('jobId') jobId: string,
    @Param('artifact')
    artifact: 'standardized' | 'rejected' | 'eval' | 'audit' | 'summary',
    @Res() res: Response,
  ) {
    const download = await this.lookupDatasetCurationJobService.getArtifact(
      jobId,
      user.organizationId,
      artifact,
    );
    res.setHeader('Content-Type', download.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${download.filename}"`,
    );
    res.send(download.body);
  }
}
