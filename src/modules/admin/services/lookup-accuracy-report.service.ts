import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import {
  LookupAccuracySmokeService,
  LookupSmokeEvaluationSummary,
} from './lookup-accuracy-smoke.service';

interface GenerateLookupReportOptions {
  datasetPath?: string;
  sampleSize?: number;
  classifySampleSize?: number;
  resultLimit?: number;
  sourceVersion?: string;
  outputDir?: string;
}

export interface LookupAccuracyReportResult {
  summary: LookupSmokeEvaluationSummary;
  jsonPath: string;
  textPath: string;
  latestJsonPath: string;
  latestTextPath: string;
}

@Injectable()
export class LookupAccuracyReportService {
  private readonly logger = new Logger(LookupAccuracyReportService.name);

  constructor(private readonly smokeService: LookupAccuracySmokeService) {}

  async generateReport(
    options: GenerateLookupReportOptions = {},
  ): Promise<LookupAccuracyReportResult> {
    const outputDir = resolve(
      process.cwd(),
      options.outputDir ||
        process.env.HTS_LOOKUP_REPORT_OUTPUT_DIR ||
        'docs/reports/lookup-eval/nightly',
    );

    const summary = await this.smokeService.runSmokeEvaluation({
      datasetPath: options.datasetPath,
      sampleSize: options.sampleSize,
      classifySampleSize: options.classifySampleSize,
      resultLimit: options.resultLimit,
      sourceVersion: options.sourceVersion,
    });

    await mkdir(outputDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `lookup-accuracy-${stamp}`;
    const jsonPath = resolve(outputDir, `${base}.json`);
    const textPath = resolve(outputDir, `${base}.summary.txt`);
    const latestJsonPath = resolve(outputDir, 'latest.json');
    const latestTextPath = resolve(outputDir, 'latest.summary.txt');

    const summaryText = `${this.buildSummaryLines(summary).join('\n')}\n`;
    await Promise.all([
      writeFile(jsonPath, JSON.stringify(summary, null, 2), 'utf-8'),
      writeFile(textPath, summaryText, 'utf-8'),
      writeFile(latestJsonPath, JSON.stringify(summary, null, 2), 'utf-8'),
      writeFile(latestTextPath, summaryText, 'utf-8'),
    ]);

    this.logger.log(
      `Lookup accuracy report generated: json=${jsonPath}, summary=${textPath}`,
    );

    return {
      summary,
      jsonPath,
      textPath,
      latestJsonPath,
      latestTextPath,
    };
  }

  private buildSummaryLines(summary: LookupSmokeEvaluationSummary): string[] {
    const auto = summary.endpointMetrics.autocomplete;
    const search = summary.endpointMetrics.search;
    const classify = summary.classificationTop1;

    return [
      `generated_at: ${new Date().toISOString()}`,
      `dataset: ${summary.datasetPath}`,
      `loaded: ${summary.totalRecordsLoaded}`,
      `sampled: ${summary.sampledRecords}`,
      `autocomplete exact@10: ${this.toPct(auto.exactTop10, auto.evaluated)}`,
      `search exact@10: ${this.toPct(search.exactTop10, search.evaluated)}`,
      `classify top1 exact: ${this.toPct(classify.exactTop1, classify.evaluated)}`,
      `classify chapter@1: ${this.toPct(classify.chapterTop1, classify.evaluated)}`,
    ];
  }

  private toPct(numerator: number, denominator: number): string {
    if (denominator <= 0) {
      return 'n/a';
    }
    return `${((numerator / denominator) * 100).toFixed(2)}%`;
  }
}
