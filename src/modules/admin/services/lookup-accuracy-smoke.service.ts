import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { SearchService, ClassificationService } from '@hts/lookup';

type EvaluationEndpoint = 'autocomplete' | 'search' | 'classify';

interface EvaluationRecord {
  id: string;
  query: string;
  expectedHtsNumber: string;
  expectedChapter?: string;
  acceptableHtsNumbers?: string[];
  acceptableChapters?: string[];
  ambiguity?: string;
  endpoints?: EvaluationEndpoint[];
}

interface EndpointMetrics {
  evaluated: number;
  exactTop1: number;
  exactTop3: number;
  exactTop10: number;
  chapterTop10: number;
  errors: number;
}

export interface LookupSmokeEvaluationSummary {
  datasetPath: string;
  totalRecordsLoaded: number;
  sampledRecords: number;
  sourceVersion?: string;
  endpointMetrics: Record<EvaluationEndpoint, EndpointMetrics>;
  classificationTop1: {
    evaluated: number;
    exactTop1: number;
    chapterTop1: number;
    errors: number;
  };
}

interface RunOptions {
  datasetPath?: string;
  sampleSize?: number;
  classifySampleSize?: number;
  resultLimit?: number;
  sourceVersion?: string;
}

@Injectable()
export class LookupAccuracySmokeService {
  private readonly logger = new Logger(LookupAccuracySmokeService.name);

  constructor(
    private readonly searchService: SearchService,
    private readonly classificationService: ClassificationService,
  ) {}

  async runSmokeEvaluation(
    options: RunOptions = {},
  ): Promise<LookupSmokeEvaluationSummary> {
    const datasetPath = resolve(
      process.cwd(),
      options.datasetPath ||
        process.env.HTS_LOOKUP_EVAL_SET_PATH ||
        'docs/evaluation/lookup-evaluation-set-v1.jsonl',
    );

    const allRecords = await this.loadEvaluationSet(datasetPath);
    const sampleSize = this.resolveNumber(
      options.sampleSize,
      process.env.HTS_LOOKUP_SMOKE_SAMPLE_SIZE,
      200,
    );
    const classifySampleSize = this.resolveNumber(
      options.classifySampleSize,
      process.env.HTS_LOOKUP_SMOKE_CLASSIFY_SAMPLE_SIZE,
      50,
    );
    const resultLimit = this.resolveNumber(
      options.resultLimit,
      process.env.HTS_LOOKUP_SMOKE_RESULT_LIMIT,
      10,
    );

    const sampled = allRecords.slice(0, Math.min(sampleSize, allRecords.length));
    const classificationSample = sampled
      .filter((record) =>
        (record.endpoints || ['autocomplete', 'search', 'classify']).includes(
          'classify',
        ),
      )
      .slice(0, classifySampleSize);

    const endpointMetrics: Record<EvaluationEndpoint, EndpointMetrics> = {
      autocomplete: this.emptyEndpointMetrics(),
      search: this.emptyEndpointMetrics(),
      classify: this.emptyEndpointMetrics(),
    };

    const classificationTop1 = {
      evaluated: 0,
      exactTop1: 0,
      chapterTop1: 0,
      errors: 0,
    };

    for (const record of sampled) {
      const endpoints = record.endpoints || ['autocomplete', 'search', 'classify'];

      if (endpoints.includes('autocomplete')) {
        await this.evaluateAutocomplete(record, resultLimit, endpointMetrics);
      }

      if (endpoints.includes('search')) {
        await this.evaluateSearch(record, resultLimit, endpointMetrics);
      }
    }

    for (const record of classificationSample) {
      await this.evaluateClassify(record, endpointMetrics, classificationTop1);
    }

    const summary: LookupSmokeEvaluationSummary = {
      datasetPath,
      totalRecordsLoaded: allRecords.length,
      sampledRecords: sampled.length,
      sourceVersion: options.sourceVersion,
      endpointMetrics,
      classificationTop1,
    };

    this.logger.log(
      `Lookup smoke evaluation complete: sampled=${summary.sampledRecords}, autocomplete(hit@10)=${this.toPct(summary.endpointMetrics.autocomplete.exactTop10, summary.endpointMetrics.autocomplete.evaluated)}, search(hit@10)=${this.toPct(summary.endpointMetrics.search.exactTop10, summary.endpointMetrics.search.evaluated)}, classify(top1)=${this.toPct(summary.classificationTop1.exactTop1, summary.classificationTop1.evaluated)}`,
    );

    return summary;
  }

  private async evaluateAutocomplete(
    record: EvaluationRecord,
    resultLimit: number,
    endpointMetrics: Record<EvaluationEndpoint, EndpointMetrics>,
  ): Promise<void> {
    const metrics = endpointMetrics.autocomplete;
    metrics.evaluated++;

    try {
      const rows = await this.searchService.autocomplete(record.query, resultLimit);
      const candidates = rows.map((row) => row.htsNumber);
      this.accumulateTopK(metrics, record, candidates);
    } catch (error) {
      metrics.errors++;
      this.logger.warn(
        `Autocomplete smoke eval failed for ${record.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async evaluateSearch(
    record: EvaluationRecord,
    resultLimit: number,
    endpointMetrics: Record<EvaluationEndpoint, EndpointMetrics>,
  ): Promise<void> {
    const metrics = endpointMetrics.search;
    metrics.evaluated++;

    try {
      const rows = await this.searchService.hybridSearch(record.query, resultLimit);
      const candidates = rows.map((row) => row.htsNumber);
      this.accumulateTopK(metrics, record, candidates);
    } catch (error) {
      metrics.errors++;
      this.logger.warn(
        `Search smoke eval failed for ${record.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async evaluateClassify(
    record: EvaluationRecord,
    endpointMetrics: Record<EvaluationEndpoint, EndpointMetrics>,
    classificationTop1: {
      evaluated: number;
      exactTop1: number;
      chapterTop1: number;
      errors: number;
    },
  ): Promise<void> {
    const metrics = endpointMetrics.classify;
    metrics.evaluated++;
    classificationTop1.evaluated++;

    try {
      const result = await this.classificationService.classifyProduct(
        record.query,
        '',
      );

      const predicted = (result.htsCode || '').trim();
      const acceptableHts = this.getAcceptableHtsNumbers(record);
      const acceptableChapters = this.getAcceptableChapters(record, acceptableHts);

      if (acceptableHts.includes(predicted)) {
        metrics.exactTop1++;
        metrics.exactTop3++;
        metrics.exactTop10++;
        classificationTop1.exactTop1++;
      }

      if (acceptableChapters.includes(predicted.substring(0, 2))) {
        metrics.chapterTop10++;
        classificationTop1.chapterTop1++;
      }
    } catch (error) {
      metrics.errors++;
      classificationTop1.errors++;
      this.logger.warn(
        `Classify smoke eval failed for ${record.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private accumulateTopK(
    metrics: EndpointMetrics,
    record: EvaluationRecord,
    candidates: string[],
  ): void {
    const acceptableHts = this.getAcceptableHtsNumbers(record);
    const acceptableChapters = this.getAcceptableChapters(record, acceptableHts);

    if (candidates[0] && acceptableHts.includes(candidates[0])) {
      metrics.exactTop1++;
    }

    if (candidates.slice(0, 3).some((hts) => acceptableHts.includes(hts))) {
      metrics.exactTop3++;
    }

    if (candidates.slice(0, 10).some((hts) => acceptableHts.includes(hts))) {
      metrics.exactTop10++;
    }

    if (
      candidates
        .slice(0, 10)
        .some((hts) => acceptableChapters.includes(hts.substring(0, 2)))
    ) {
      metrics.chapterTop10++;
    }
  }

  private async loadEvaluationSet(path: string): Promise<EvaluationRecord[]> {
    const raw = await readFile(path, 'utf-8');
    const records: EvaluationRecord[] = [];

    for (const [index, line] of raw.split('\n').entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as Partial<EvaluationRecord>;

        const acceptableFromRecord = Array.isArray(parsed.acceptableHtsNumbers)
          ? parsed.acceptableHtsNumbers
          : [];
        const acceptableHts = [
          ...new Set(
            [...acceptableFromRecord, parsed.expectedHtsNumber || '']
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ];

        if (!parsed.id || !parsed.query || acceptableHts.length === 0) {
          continue;
        }

        const expectedHtsNumber =
          (parsed.expectedHtsNumber || '').trim() || acceptableHts[0];
        const chapterFromExpected = expectedHtsNumber.substring(0, 2);

        const acceptableChapters = [
          ...new Set(
            [
              ...(Array.isArray(parsed.acceptableChapters)
                ? parsed.acceptableChapters
                : []),
              parsed.expectedChapter || '',
              chapterFromExpected,
              ...acceptableHts.map((hts) => hts.substring(0, 2)),
            ]
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ];

        const endpoints = [
          ...new Set(
            (parsed.endpoints || ['autocomplete', 'search', 'classify']).filter(
              (value): value is EvaluationEndpoint =>
                value === 'autocomplete' ||
                value === 'search' ||
                value === 'classify',
            ),
          ),
        ];

        if (acceptableHts.length > 1 && endpoints.includes('classify')) {
          this.logger.warn(
            `Ambiguous eval row ${parsed.id} includes classify endpoint; removing classify for this row.`,
          );
        }

        const normalizedEndpoints =
          acceptableHts.length > 1
            ? endpoints.filter((endpoint) => endpoint !== 'classify')
            : endpoints;

        if (normalizedEndpoints.length === 0) {
          normalizedEndpoints.push('autocomplete', 'search');
        }

        records.push({
          id: parsed.id,
          query: parsed.query,
          expectedHtsNumber,
          expectedChapter: acceptableChapters[0],
          acceptableHtsNumbers:
            acceptableHts.length > 1 ? acceptableHts : undefined,
          acceptableChapters:
            acceptableChapters.length > 1 ? acceptableChapters : undefined,
          ambiguity: parsed.ambiguity,
          endpoints: normalizedEndpoints,
        });
      } catch {
        this.logger.warn(`Skipping invalid evaluation row at line ${index + 1}`);
      }
    }

    if (records.length === 0) {
      throw new Error(`No valid evaluation records found in ${path}`);
    }

    this.validateLoadedRecords(records);

    return records;
  }

  private getAcceptableHtsNumbers(record: EvaluationRecord): string[] {
    const expected = record.expectedHtsNumber.trim();
    const additional = Array.isArray(record.acceptableHtsNumbers)
      ? record.acceptableHtsNumbers
      : [];

    return [
      ...new Set(
        [expected, ...additional].map((item) => item.trim()).filter(Boolean),
      ),
    ];
  }

  private getAcceptableChapters(
    record: EvaluationRecord,
    acceptableHtsNumbers: string[],
  ): string[] {
    const expectedChapter = (record.expectedChapter || '').trim();
    const additional = Array.isArray(record.acceptableChapters)
      ? record.acceptableChapters
      : [];

    return [
      ...new Set(
        [
          expectedChapter,
          ...additional,
          ...acceptableHtsNumbers.map((value) => value.substring(0, 2)),
        ]
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
  }

  private validateLoadedRecords(records: EvaluationRecord[]): void {
    const queryCounts = new Map<string, number>();
    const queryToLabels = new Map<string, Set<string>>();

    for (const record of records) {
      const key = record.query.toLowerCase().trim();
      queryCounts.set(key, (queryCounts.get(key) || 0) + 1);
      const labels = this.getAcceptableHtsNumbers(record);

      if (!queryToLabels.has(key)) {
        queryToLabels.set(key, new Set(labels));
        continue;
      }

      const existing = queryToLabels.get(key)!;
      for (const label of labels) {
        existing.add(label);
      }
    }

    const duplicateQueries = [...queryCounts.entries()].filter(
      ([, count]) => count > 1,
    );
    if (duplicateQueries.length > 0) {
      const sample = duplicateQueries
        .slice(0, 5)
        .map(([query, count]) => `"${query}"(${count})`)
        .join(', ');
      throw new Error(
        `Evaluation set has duplicate query rows; collapse duplicates into one multi-label row. Examples: ${sample}`,
      );
    }

    for (const [query, labels] of queryToLabels.entries()) {
      if (labels.size > 1 && query === 'other') {
        this.logger.warn(
          `Evaluation set contains low-information ambiguous query "${query}" (${labels.size} labels).`,
        );
      }
    }
  }

  private emptyEndpointMetrics(): EndpointMetrics {
    return {
      evaluated: 0,
      exactTop1: 0,
      exactTop3: 0,
      exactTop10: 0,
      chapterTop10: 0,
      errors: 0,
    };
  }

  private resolveNumber(
    optionValue: number | undefined,
    envValue: string | undefined,
    fallback: number,
  ): number {
    if (Number.isFinite(optionValue)) {
      return Math.max(0, Math.floor(optionValue as number));
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
