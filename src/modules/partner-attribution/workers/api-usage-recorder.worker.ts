import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueService } from '../../queue/queue.service';
import { ApiUsageMetricEntity } from '../../api-keys/entities/api-usage-metric.entity';
import { API_USAGE_RECORD_QUEUE, ApiUsageRecordJob } from '../interceptors/usage-recording.interceptor';

/**
 * pg-boss handler that drains 'api-usage-record' and INSERTs into
 * api_usage_metrics. Batches up to 100 jobs per fetch via the team config.
 *
 * Errors per row are logged + retried (pg-boss handles retries based on
 * retryLimit). After exhausting retries, pg-boss moves to its dead-letter
 * queue and we drop on the floor — usage metrics are observability,
 * not authoritative.
 */
@Injectable()
export class ApiUsageRecorderWorker implements OnModuleInit {
  private readonly logger = new Logger(ApiUsageRecorderWorker.name);

  constructor(
    private readonly queue: QueueService,
    @InjectRepository(ApiUsageMetricEntity)
    private readonly metrics: Repository<ApiUsageMetricEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(
      API_USAGE_RECORD_QUEUE,
      async (job) => {
        // QueueService dispatches single jobs to the handler (it iterates pg-boss
        // batches internally). For higher throughput we'd buffer here, but at
        // expected volumes (browser calculator traffic) per-row insert is fine.
        const row = this.toEntity(job.data as unknown as ApiUsageRecordJob);
        if (!row) return;
        try {
          await this.metrics.insert(row);
        } catch (err) {
          this.logger.warn(
            `Usage row insert failed (will retry per pg-boss policy): ${(err as Error)?.message}; partner=${row.partnerId} endpoint=${row.endpoint}`,
          );
          throw err;
        }
      },
      { teamSize: 5, teamConcurrency: 1 },
    );
    this.logger.log(`Worker registered for ${API_USAGE_RECORD_QUEUE}`);
  }

  private toEntity(data: ApiUsageRecordJob): ApiUsageMetricEntity | null {
    // If both partnerId and organizationId are null, we can't satisfy NOT NULL
    // on organizationId — drop the row rather than fail the whole batch.
    const organizationId = data.organizationId ?? data.partnerId;
    if (!organizationId) {
      this.logger.debug(
        `Dropping usage row with no organizationId: endpoint=${data.endpoint} source=${data.attributionSource}`,
      );
      return null;
    }
    const ent = new ApiUsageMetricEntity();
    ent.apiKeyId = data.apiKeyId;
    ent.organizationId = organizationId;
    ent.partnerId = data.partnerId;
    ent.partnerUserId = data.partnerUserId;
    ent.attributionSource = (data.attributionSource as ApiUsageMetricEntity['attributionSource']) ?? null;
    ent.origin = data.origin;
    ent.timestamp = new Date(data.timestamp);
    ent.endpoint = data.endpoint;
    ent.method = data.method;
    ent.statusCode = data.statusCode;
    ent.responseTimeMs = data.responseTimeMs;
    ent.requestSizeBytes = data.requestSizeBytes;
    ent.responseSizeBytes = data.responseSizeBytes;
    ent.clientIp = data.clientIp;
    ent.userAgent = data.userAgent;
    ent.errorMessage = data.errorMessage;
    ent.htsCode = data.htsCode;
    ent.countryCode = data.countryCode;
    return ent;
  }
}
