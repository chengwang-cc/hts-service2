import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { TelemetryService } from '../../observability/telemetry.service';
import {
  BrokerOutreachDiscoveryResultEntity,
  BrokerOutreachDiscoveryRunEntity,
  BrokerOutreachLeadEntity,
} from '../entities';

export interface DiscoveryRunBegin {
  provider: 'osm' | 'google-search' | string;
  input: Record<string, unknown>;
  triggeredBy: string;
  jobId?: string | null;
}

export interface DiscoveryRunFinishCounts {
  fetched: number;
  inserted: number;
  updated: number;
  failed?: number;
  status?: 'succeeded' | 'failed' | 'partial';
  errorMessage?: string | null;
}

/**
 * Durable audit ledger for broker-outreach discovery runs. Persists one
 * `broker_outreach_discovery_runs` row per attempt + one
 * `broker_outreach_discovery_results` row per discovered candidate.
 * Used by both the OSM and Google Search discovery paths.
 */
@Injectable()
export class BrokerOutreachDiscoveryLedgerService {
  private readonly logger = new Logger(BrokerOutreachDiscoveryLedgerService.name);

  constructor(
    @InjectRepository(BrokerOutreachDiscoveryRunEntity)
    private readonly runs: Repository<BrokerOutreachDiscoveryRunEntity>,
    @InjectRepository(BrokerOutreachDiscoveryResultEntity)
    private readonly results: Repository<BrokerOutreachDiscoveryResultEntity>,
    @Optional() private readonly telemetry: TelemetryService | null = null,
  ) {}

  async beginRun(
    input: DiscoveryRunBegin,
  ): Promise<BrokerOutreachDiscoveryRunEntity> {
    const row = this.runs.create({
      provider: input.provider,
      status: 'running',
      input: input.input,
      triggeredBy: input.triggeredBy,
      jobId: input.jobId ?? null,
      startedAt: new Date(),
    });
    const saved = await this.runs.save(row);
    this.logger.log(
      `discovery.run.start provider=${input.provider} runId=${saved.id} triggeredBy=${input.triggeredBy}`,
    );
    return saved;
  }

  async finishRun(
    runId: string,
    counts: DiscoveryRunFinishCounts,
  ): Promise<BrokerOutreachDiscoveryRunEntity> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`discovery run not found: ${runId}`);
    run.fetchedCount = counts.fetched;
    run.insertedCount = counts.inserted;
    run.updatedCount = counts.updated;
    run.failedCount = counts.failed ?? 0;
    run.completedAt = new Date();
    run.status =
      counts.status ??
      ((counts.failed ?? 0) > 0 && counts.inserted + counts.updated === 0
        ? 'failed'
        : (counts.failed ?? 0) > 0
          ? 'partial'
          : 'succeeded');
    run.errorMessage = counts.errorMessage ?? null;
    const saved = await this.runs.save(run);
    this.telemetry?.countEvent('broker_outreach_discovery_runs_total', {
      provider: saved.provider,
      status: saved.status,
    });
    this.logger.log(
      `discovery.run.finish runId=${runId} status=${saved.status} fetched=${counts.fetched} inserted=${counts.inserted} updated=${counts.updated} failed=${counts.failed ?? 0}`,
    );
    return saved;
  }

  async recordResult(
    runId: string,
    input: {
      status: 'ingested' | 'updated' | 'skipped' | 'failed';
      externalId?: string | null;
      companyName?: string | null;
      websiteUrl?: string | null;
      lead?: BrokerOutreachLeadEntity | null;
      payload?: Record<string, unknown> | null;
      errorMessage?: string | null;
    },
  ): Promise<void> {
    const row = this.results.create({
      runId,
      status: input.status,
      externalId: input.externalId ?? null,
      companyName: input.companyName ?? null,
      websiteUrl: input.websiteUrl ?? null,
      leadId: input.lead?.id ?? null,
      payload: input.payload ?? null,
      errorMessage: input.errorMessage ?? null,
    });
    await this.results.save(row);
  }

  async listRuns(filter: {
    provider?: string;
    status?: string;
    limit?: number;
  } = {}): Promise<BrokerOutreachDiscoveryRunEntity[]> {
    return this.runs.find({
      where: {
        ...(filter.provider ? { provider: filter.provider } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: Math.max(1, Math.min(200, filter.limit ?? 50)),
    });
  }

  async listResults(
    runId: string,
    limit = 200,
  ): Promise<BrokerOutreachDiscoveryResultEntity[]> {
    return this.results.find({
      where: { runId },
      order: { createdAt: 'ASC' },
      take: Math.max(1, Math.min(1000, limit)),
    });
  }
}
