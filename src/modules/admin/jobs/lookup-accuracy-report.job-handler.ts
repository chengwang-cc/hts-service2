import { Injectable, Logger } from '@nestjs/common';
import { LookupAccuracyReportService } from '../services/lookup-accuracy-report.service';

interface LookupAccuracyReportJobData {
  datasetPath?: string;
  outputDir?: string;
  sourceVersion?: string;
  sampleSize?: number;
  classifySampleSize?: number;
  resultLimit?: number;
}

@Injectable()
export class LookupAccuracyReportJobHandler {
  private readonly logger = new Logger(LookupAccuracyReportJobHandler.name);

  constructor(private readonly reportService: LookupAccuracyReportService) {}

  async execute(job: { id?: string; data?: LookupAccuracyReportJobData }): Promise<void> {
    const data = job.data || {};
    const sampleSize = this.resolveInt(
      data.sampleSize,
      process.env.HTS_LOOKUP_NIGHTLY_SAMPLE_SIZE,
      300,
    );
    const classifySampleSize = this.resolveInt(
      data.classifySampleSize,
      process.env.HTS_LOOKUP_NIGHTLY_CLASSIFY_SAMPLE_SIZE,
      80,
    );
    const resultLimit = this.resolveInt(
      data.resultLimit,
      process.env.HTS_LOOKUP_NIGHTLY_RESULT_LIMIT,
      10,
    );

    this.logger.log(
      `Starting lookup nightly accuracy report job id=${job.id || 'unknown'} sample=${sampleSize} classifySample=${classifySampleSize} limit=${resultLimit}`,
    );

    const report = await this.reportService.generateReport({
      datasetPath: data.datasetPath || process.env.HTS_LOOKUP_NIGHTLY_DATASET_PATH,
      outputDir: data.outputDir || process.env.HTS_LOOKUP_NIGHTLY_OUTPUT_DIR,
      sourceVersion: data.sourceVersion,
      sampleSize,
      classifySampleSize,
      resultLimit,
    });

    const auto = report.summary.endpointMetrics.autocomplete;
    const search = report.summary.endpointMetrics.search;
    const classify = report.summary.classificationTop1;

    this.logger.log(
      `Nightly lookup accuracy report complete: sampled=${report.summary.sampledRecords}, autocomplete_exact@10=${this.toPct(auto.exactTop10, auto.evaluated)}, search_exact@10=${this.toPct(search.exactTop10, search.evaluated)}, classify_top1=${this.toPct(classify.exactTop1, classify.evaluated)}, json=${report.jsonPath}`,
    );
  }

  private resolveInt(
    value: number | undefined,
    envValue: string | undefined,
    fallback: number,
  ): number {
    if (Number.isFinite(value)) {
      return Math.max(0, Math.floor(value as number));
    }

    const parsed = envValue ? parseInt(envValue, 10) : NaN;
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }

    return fallback;
  }

  private toPct(numerator: number, denominator: number): string {
    if (denominator <= 0) {
      return 'n/a';
    }
    return `${((numerator / denominator) * 100).toFixed(2)}%`;
  }
}
