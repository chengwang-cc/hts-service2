/**
 * Calculator accuracy admin endpoints.
 *
 * Surfaces the freshness + evidence-coverage reports the calculator-v2
 * accuracy plan calls for. The admin coverage dashboard reads from these;
 * the rollout gate (Phase 6) consults them before promoting a formula
 * change to production.
 *
 * Endpoints:
 *   GET  /admin/calculator/accuracy/tick   — current snapshot (freshness + coverage + review tasks)
 *   GET  /admin/calculator/accuracy/coverage — evidence coverage only
 *   GET  /admin/calculator/accuracy/freshness — source freshness only
 *
 * The data provider is dependency-injected via an in-memory fixture today
 * so the dashboard can render against synthetic data while real ingestion
 * is being built; production will swap in a TypeORM-backed provider.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../admin/guards/admin.guard';
import {
  AccuracySchedulerService,
  AccuracyDataProvider,
} from './accuracy-scheduler.service';
import { TariffSourceFreshnessService } from './tariff-source-freshness.service';
import { EvidenceCoverageService } from './evidence-coverage.service';

/**
 * In-memory data provider used while real ingestion is being built. Returns
 * an empty dataset so the endpoint always returns a well-formed response —
 * the dashboard can render the empty state immediately. Swap the binding
 * in calculator.module.ts to a TypeORM-backed provider when ready.
 */
const EMPTY_PROVIDER: AccuracyDataProvider = {
  loadFreshnessRecords: async () => [],
  loadEvidenceRecords: async () => [],
};

@ApiTags('Admin - Calculator Accuracy')
@ApiBearerAuth()
@Controller('admin/calculator/accuracy')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AccuracyController {
  constructor(
    private readonly scheduler: AccuracySchedulerService,
    private readonly freshness: TariffSourceFreshnessService,
    private readonly coverage: EvidenceCoverageService,
  ) {}

  @Get('tick')
  @ApiOperation({
    summary: 'Run an accuracy tick and return the review queue',
  })
  async tick() {
    return this.scheduler.tick(EMPTY_PROVIDER);
  }

  @Get('freshness')
  @ApiOperation({ summary: 'Tariff source freshness snapshot' })
  async getFreshness() {
    const records = await EMPTY_PROVIDER.loadFreshnessRecords();
    const reports = this.freshness.scoreBatch(records);
    return {
      reports,
      summary: this.freshness.summarize(reports),
    };
  }

  @Get('coverage')
  @ApiOperation({ summary: 'Evidence coverage per active component' })
  async getCoverage() {
    const records = await EMPTY_PROVIDER.loadEvidenceRecords();
    const reports = this.coverage.reportBatch(records);
    return {
      reports,
      summary: this.coverage.summarize(reports),
    };
  }
}
