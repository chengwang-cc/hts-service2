import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { QueueService } from '../../queue/queue.service';
import { LookupDatasetCurationJobDto } from '../dto';
import { LookupDatasetCurationJobEntity } from '../entities/lookup-dataset-curation-job.entity';
import { QueryNormalizationService } from './query-normalization.service';
import { SearchService } from './search.service';

export const LOOKUP_DATASET_CURATION_QUEUE = 'lookup-dataset-curation-job';

interface RawCsvRow {
  hts_code?: string;
  hts_number?: string;
  custom_description?: string;
  description?: string;
  query?: string;
}

interface StandardizedRow {
  queryId: string;
  canonicalHtsNumber: string;
  canonicalHtsDigits: string;
  originalDescription: string;
  standardizedDescription: string;
  standardizedQuery: string;
  noiseFlags: string[];
  noiseScore: number;
  qualityFlags: string[];
  qualityScore: number;
  evalEligible: boolean;
}

interface EvalRow {
  queryId: string;
  standardizedQuery: string;
  representativeDescription: string;
  expectedHtsNumber: string;
  acceptableHtsNumbers: string[];
  expectedChapter: string;
  ambiguity: 'single_label' | 'multi_label';
  contributingStandardizedRows: number;
  maxNoiseScore: number;
}

interface AuditRow {
  auditId: string;
  priorityScore: number;
  priorityFlags: string[];
  queryId: string;
  standardizedQuery: string;
  normalizedQuery: string;
  aiNormalizedQuery: string;
  aiSearchPhrases: string[];
  aiHeadingHints: string[];
  aiIgnoreTerms: string[];
  representativeDescription: string;
  expectedHtsNumber: string;
  acceptableHtsNumbers: string[];
  expectedChapter: string;
  ambiguity: string;
  contributingStandardizedRows: number;
  maxNoiseScore: number;
  liveStatus: number;
  liveLatencyMs: number;
  liveTop1HtsNumber: string;
  liveTop1Description: string;
  liveTop10HtsNumbers: string[];
  liveExactTop1: boolean;
  liveExactTop10: boolean;
  expectedHtsDescription: string;
  expectedHtsPath: string;
  auditStatus: 'PENDING';
  auditedHtsNumber: string;
  auditedDescription: string;
  reviewerNotes: string;
}

interface HtsDetailLike {
  description?: string | null;
  fullDescription?: string[] | null;
}

interface ProcessingArtifacts {
  standardizedRows: StandardizedRow[];
  rejectedRows: StandardizedRow[];
  evalRows: EvalRow[];
  auditRows: AuditRow[];
  stats: Record<string, unknown>;
  auditSummary: Record<string, unknown>;
}

interface SearchProbeResult {
  status: number;
  latencyMs: number;
  normalizedQuery: string;
  top10: Array<{ htsNumber: string; description: string }>;
  error?: string;
}

@Injectable()
export class LookupDatasetCurationJobService {
  private readonly logger = new Logger(LookupDatasetCurationJobService.name);

  private readonly stopWords = new Set([
    'a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'used', 'with',
  ]);

  private readonly boundaryStopwords = new Set([
    'a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with',
  ]);

  private readonly materialTokens = new Set([
    'acrylic', 'aluminum', 'aluminium', 'cotton', 'gold', 'iron', 'metal', 'nylon',
    'plastic', 'polyester', 'silver', 'steel', 'wool',
  ]);

  private readonly articleTokens = new Set([
    'apron', 'bag', 'bags', 'belt', 'belts', 'blank', 'blanket', 'blankets', 'bottle',
    'bottles', 'bracelet', 'bra', 'bras', 'cap', 'caps', 'card', 'cards', 'case', 'cases',
    'cd', 'cds', 'chain', 'chains', 'cloth', 'comic', 'comics', 'cord', 'dress', 'dresses',
    'dishcloth', 'dvd', 'dvds', 'earring', 'earrings', 'fabric', 'footwear', 'glove',
    'gloves', 'hoodie', 'hose', 'jewelry', 'jacket', 'keychain', 'keychains', 'leggings',
    'mat', 'mats', 'mug', 'mugs', 'necklace', 'necklaces', 'pants', 'panties', 'patch',
    'patches', 'pillow', 'pillows', 'plaque', 'poster', 'posters', 'poplin', 'rivet',
    'rivets', 'ring', 'rings', 'rope', 'scarf', 'sandals', 'shirt', 'shirts', 'shoes',
    'shoe', 'shorts', 'skirt', 'skirts', 'sneaker', 'sneakers', 'sock', 'socks', 'strap',
    'straps', 'sweater', 'sweaters', 'thread', 'threads', 'towel', 'towels', 'toy', 'toys',
    'trousers', 'wig', 'wigs', 'yarn',
  ]);

  private readonly genericVariantTokens = new Set([
    'assorted', 'black', 'blue', 'brown', 'coastal', 'cream', 'dark', 'gold', 'green',
    'grey', 'ivory', 'khaki', 'lavender', 'light', 'limited', 'mini', 'natural', 'new',
    'orange', 'pink', 'purple', 'red', 'sample', 'samples', 'silver', 'small', 'tall',
    'teal', 'vintage', 'white', 'yellow',
  ]);

  private readonly tokenSynonyms: Record<string, string[]> = {
    baby: ['infant', 'infants'],
    babies: ['infant', 'infants'],
    bag: ['bags'],
    bags: ['bag'],
    cord: ['cords', 'rope', 'ropes', 'twine'],
    fabric: ['fabrics', 'woven'],
    fabrics: ['fabric', 'woven'],
    glove: ['gloves'],
    gloves: ['glove'],
    infants: ['infant', 'baby'],
    infant: ['infants', 'baby'],
    pants: ['trousers'],
    shoes: ['shoe', 'footwear'],
    shoe: ['shoes', 'footwear'],
    strap: ['straps', 'webbing'],
    straps: ['strap', 'webbing'],
    thread: ['threads', 'cord'],
    yarn: ['yarns'],
  };

  constructor(
    @InjectRepository(LookupDatasetCurationJobEntity)
    private readonly jobRepository: Repository<LookupDatasetCurationJobEntity>,
    private readonly queueService: QueueService,
    private readonly searchService: SearchService,
    private readonly queryNormalizationService: QueryNormalizationService,
  ) {}

  async createJob(
    user: any,
    file: Express.Multer.File,
    dto: LookupDatasetCurationJobDto,
  ) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!file) {
      throw new BadRequestException('CSV file is required (field name: "file")');
    }
    if (
      !file.originalname.match(/\.csv$/i) &&
      file.mimetype !== 'text/csv' &&
      file.mimetype !== 'application/vnd.ms-excel'
    ) {
      throw new BadRequestException('Only CSV files are accepted');
    }

    const job = await this.jobRepository.save(
      this.jobRepository.create({
        organizationId: user.organizationId,
        createdBy: user.id ?? null,
        status: 'pending',
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        sourceCsvData: file.buffer,
        optionsJson: {
          maxPerCode: dto.maxPerCode ?? 3,
          auditSubsetSize: dto.auditSubsetSize ?? 300,
          probeLimit: dto.probeLimit ?? 10,
          probeTimeoutMs: dto.probeTimeoutMs ?? 15000,
          concurrency: dto.concurrency ?? 6,
          aiAssist: dto.aiAssist ?? true,
          aiMode: dto.aiMode ?? 'audit-only',
        },
      }),
    );

    const queueJobId = await this.queueService.sendJob(
      LOOKUP_DATASET_CURATION_QUEUE,
      { jobId: job.id },
      {
        retryLimit: 1,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 7200,
      },
    );

    await this.jobRepository.update(job.id, { queueJobId });
    return this.getJob(job.id, user.organizationId);
  }

  async getJob(jobId: string, organizationId: string) {
    const job = await this.jobRepository.findOne({
      where: { id: jobId, organizationId },
    });
    if (!job) {
      throw new NotFoundException(`Dataset curation job ${jobId} not found`);
    }

    return {
      id: job.id,
      status: job.status,
      originalFilename: job.originalFilename,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      options: job.optionsJson,
      summary: job.summaryJson,
      auditSummary: job.auditSummaryJson,
      artifacts: {
        standardizedCsv: Boolean(job.standardizedCsv),
        rejectedCsv: Boolean(job.rejectedCsv),
        evalCsv: Boolean(job.evalCsv),
        auditCsv: Boolean(job.auditCsv),
      },
    };
  }

  async getArtifact(
    jobId: string,
    organizationId: string,
    artifact: 'standardized' | 'rejected' | 'eval' | 'audit' | 'summary',
  ): Promise<{ contentType: string; filename: string; body: string }> {
    const job = await this.jobRepository.findOne({
      where: { id: jobId, organizationId },
    });
    if (!job) {
      throw new NotFoundException(`Dataset curation job ${jobId} not found`);
    }

    if (artifact === 'summary') {
      return {
        contentType: 'application/json',
        filename: `lookup-dataset-curation-${job.id}-summary.json`,
        body: `${JSON.stringify(
          {
            summary: job.summaryJson,
            auditSummary: job.auditSummaryJson,
          },
          null,
          2,
        )}\n`,
      };
    }

    const artifactMap = {
      standardized: job.standardizedCsv,
      rejected: job.rejectedCsv,
      eval: job.evalCsv,
      audit: job.auditCsv,
    } as const;
    const body = artifactMap[artifact];
    if (!body) {
      throw new NotFoundException(`Artifact ${artifact} not available for job ${jobId}`);
    }

    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `lookup-dataset-curation-${job.id}-${artifact}.csv`,
      body,
    };
  }

  async processJob(jobId: string): Promise<void> {
    const job = await this.jobRepository.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Dataset curation job ${jobId} not found`);
    }
    if (job.status === 'completed') {
      return;
    }

    await this.jobRepository.update(job.id, {
      status: 'processing',
      startedAt: job.startedAt ?? new Date(),
      errorMessage: null,
    });

    try {
      const artifacts = await this.runConversion(
        job.sourceCsvData ?? Buffer.alloc(0),
        job.optionsJson as LookupDatasetCurationJobDto,
      );

      await this.jobRepository.update(job.id, {
        status: 'completed',
        completedAt: new Date(),
        sourceCsvData: null,
        summaryJson: artifacts.stats as any,
        auditSummaryJson: artifacts.auditSummary as any,
        standardizedCsv: this.toStandardizedCsv(artifacts.standardizedRows),
        rejectedCsv: this.toRejectedCsv(artifacts.rejectedRows),
        evalCsv: this.toEvalCsv(artifacts.evalRows),
        auditCsv: this.toAuditCsv(artifacts.auditRows),
        errorMessage: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Dataset curation job ${jobId} failed: ${message}`);
      await this.jobRepository.update(job.id, {
        status: 'failed',
        errorMessage: message,
      });
      throw error;
    }
  }

  private async runConversion(
    sourceCsvData: Buffer,
    options: LookupDatasetCurationJobDto,
  ): Promise<ProcessingArtifacts> {
    let rows: RawCsvRow[];
    try {
      rows = csvParse(sourceCsvData, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
      }) as RawCsvRow[];
    } catch {
      throw new BadRequestException('Invalid CSV file');
    }

    if (!rows.length) {
      throw new BadRequestException('CSV file is empty');
    }

    const maxPerCode = options.maxPerCode ?? 3;
    const standardizedMap = new Map<string, StandardizedRow>();
    const stats = {
      totalRows: rows.length,
      invalidHtsRows: 0,
      emptyDescriptionRows: 0,
      uniqueStandardizedRows: 0,
      uniqueStandardizedQueries: 0,
      uniqueHtsNumbers: 0,
      ambiguousQueries: 0,
      rowsWithHtml: 0,
      rowsWithMeasure: 0,
      rowsWithCount: 0,
      rowsWithOptions: 0,
      retainedStandardizedRows: 0,
      rejectedStandardizedRows: 0,
      retainedStandardizedQueries: 0,
      qualityFlagCounts: {} as Record<string, number>,
      evalRowsBeforeValidation: 0,
      evalRows: 0,
    };

    for (const row of rows) {
      const rawHts = row.hts_code || row.hts_number || '';
      const rawDescription = row.custom_description || row.description || row.query || '';
      const htsDigits = this.normalizeHtsDigits(rawHts);
      if (htsDigits.length !== 10) {
        stats.invalidHtsRows++;
        continue;
      }

      const standardizedDescription = this.standardizeDescription(rawDescription);
      const standardizedQuery = this.standardizeQuery(rawDescription);
      if (!standardizedDescription || !standardizedQuery) {
        stats.emptyDescriptionRows++;
        continue;
      }

      const noiseFlags = this.detectNoiseFlags(rawDescription);
      if (noiseFlags.includes('html')) stats.rowsWithHtml++;
      if (noiseFlags.includes('measure')) stats.rowsWithMeasure++;
      if (noiseFlags.includes('count')) stats.rowsWithCount++;
      if (noiseFlags.includes('options')) stats.rowsWithOptions++;

      const canonicalHtsNumber = this.formatHtsNumber(htsDigits);
      const key = `${canonicalHtsNumber}\t${standardizedQuery}`;
      if (!standardizedMap.has(key)) {
        standardizedMap.set(key, {
          queryId: `std-${this.md5(key).slice(0, 12)}`,
          canonicalHtsNumber,
          canonicalHtsDigits: htsDigits,
          originalDescription: this.stripHtml(rawDescription),
          standardizedDescription,
          standardizedQuery,
          noiseFlags,
          noiseScore: noiseFlags.length,
          qualityFlags: [],
          qualityScore: 0,
          evalEligible: false,
        });
      }
    }

    const standardizedRows = [...standardizedMap.values()].sort((a, b) =>
      a.canonicalHtsNumber === b.canonicalHtsNumber
        ? a.standardizedQuery.localeCompare(b.standardizedQuery)
        : a.canonicalHtsNumber.localeCompare(b.canonicalHtsNumber),
    );

    const detailCodes = [...new Set(standardizedRows.map((row) => row.canonicalHtsNumber))];
    const detailMap = new Map<string, HtsDetailLike | null>();
    await this.mapWithConcurrency(detailCodes, options.concurrency ?? 6, async (code) => {
      const detail = await this.searchService.findByHtsNumber(code);
      detailMap.set(code, detail);
    });

    const assessedRows = standardizedRows.map((row) => {
      const assessment = this.assessRowQuality(
        row,
        detailMap.get(row.canonicalHtsNumber) ?? undefined,
      );
      return {
        ...row,
        qualityFlags: assessment.qualityFlags,
        qualityScore: assessment.qualityScore,
        evalEligible:
          assessment.evalEligible &&
          this.isEvalEligible(
            row.standardizedQuery,
            detailMap.get(row.canonicalHtsNumber) ?? undefined,
          ),
      };
    });

    for (const row of assessedRows) {
      for (const flag of row.qualityFlags) {
        stats.qualityFlagCounts[flag] = (stats.qualityFlagCounts[flag] || 0) + 1;
      }
    }

    const queryToCodes = new Map<string, Set<string>>();
    for (const row of assessedRows) {
      if (!queryToCodes.has(row.standardizedQuery)) {
        queryToCodes.set(row.standardizedQuery, new Set());
      }
      queryToCodes.get(row.standardizedQuery)!.add(row.canonicalHtsNumber);
    }

    const retainedRows = assessedRows.filter((row) => row.qualityScore >= 60);
    const rejectedRows = assessedRows.filter((row) => row.qualityScore < 60);
    const evalRows = this.pickEvalRows(
      assessedRows.filter((row) => row.evalEligible),
      maxPerCode,
    );
    const auditRows = await this.buildAuditRows(evalRows, options);

    stats.uniqueStandardizedRows = assessedRows.length;
    stats.uniqueStandardizedQueries = queryToCodes.size;
    stats.uniqueHtsNumbers = detailCodes.length;
    stats.ambiguousQueries = [...queryToCodes.values()].filter((codes) => codes.size > 1).length;
    stats.retainedStandardizedRows = retainedRows.length;
    stats.rejectedStandardizedRows = rejectedRows.length;
    stats.retainedStandardizedQueries = new Set(
      retainedRows.map((row) => row.standardizedQuery),
    ).size;
    stats.evalRowsBeforeValidation = this.pickEvalRows(retainedRows, maxPerCode).length;
    stats.evalRows = evalRows.length;

    const auditSummary = {
      subsetSize: auditRows.length,
      exactTop1InSubset: auditRows.filter((row) => row.liveExactTop1).length,
      exactTop10InSubset: auditRows.filter((row) => row.liveExactTop10).length,
      topPriorityFlags: Object.entries(
        auditRows.reduce<Record<string, number>>((acc, row) => {
          for (const flag of row.priorityFlags) {
            acc[flag] = (acc[flag] || 0) + 1;
          }
          return acc;
        }, {}),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20),
    };

    return {
      standardizedRows: retainedRows,
      rejectedRows,
      evalRows,
      auditRows,
      stats,
      auditSummary,
    };
  }

  private async buildAuditRows(
    evalRows: EvalRow[],
    options: LookupDatasetCurationJobDto,
  ): Promise<AuditRow[]> {
    const subsetSize = options.auditSubsetSize ?? 300;
    const probeLimit = options.probeLimit ?? 10;
    const probeCandidates = evalRows
      .map((row) => ({
        row,
        ...this.computeStaticPriority(row),
      }))
      .sort((a, b) =>
        b.score === a.score
          ? this.md5(`${a.row.queryId}:${a.row.standardizedQuery}`).localeCompare(
              this.md5(`${b.row.queryId}:${b.row.standardizedQuery}`),
            )
          : b.score - a.score,
      )
      .slice(0, Math.min(evalRows.length, subsetSize * 2));

    const probed = await this.mapWithConcurrency(
      probeCandidates,
      options.concurrency ?? 6,
      async (candidate) => {
        const probe = await this.probeSearch(
          candidate.row.standardizedQuery,
          probeLimit,
        );
        const dynamic = this.applyDynamicPriority(
          candidate.score,
          candidate.flags,
          candidate.row,
          probe,
        );
        return {
          row: candidate.row,
          probe,
          priorityScore: dynamic.score,
          priorityFlags: dynamic.flags,
        };
      },
    );

    const selected = probed
      .sort((a, b) =>
        b.priorityScore === a.priorityScore
          ? this.md5(`${a.row.queryId}:${a.row.standardizedQuery}`).localeCompare(
              this.md5(`${b.row.queryId}:${b.row.standardizedQuery}`),
            )
          : b.priorityScore - a.priorityScore,
      )
      .slice(0, subsetSize);

    const detailCodes = [...new Set(
      selected.flatMap((item) => [
        item.row.expectedHtsNumber,
        item.probe.top10[0]?.htsNumber || '',
      ]).filter(Boolean),
    )];
    const detailMap = new Map<string, HtsDetailLike | null>();
    await this.mapWithConcurrency(detailCodes, options.concurrency ?? 6, async (code) => {
      detailMap.set(code, await this.searchService.findByHtsNumber(code));
    });

    const aiNormalizationMap = new Map<
      string,
      { normalizedQuery: string; searchPhrases: string[]; headingHints: string[]; ignoreTerms: string[] }
    >();
    if ((options.aiAssist ?? true) && (options.aiMode ?? 'audit-only') === 'audit-only') {
      await this.mapWithConcurrency(selected, Math.min(options.concurrency ?? 6, 4), async (item) => {
        const sourceText =
          item.row.representativeDescription || item.row.standardizedQuery;
        const normalization = await this.queryNormalizationService.normalize(sourceText);
        aiNormalizationMap.set(item.row.queryId, {
          normalizedQuery:
            normalization?.normalizedQuery || item.probe.normalizedQuery || item.row.standardizedQuery,
          searchPhrases: normalization?.searchPhrases || [],
          headingHints: normalization?.headingHints || [],
          ignoreTerms: normalization?.ignoreTerms || [],
        });
      });
    }

    return selected.map((item) => {
      const top1 = item.probe.top10[0];
      const expectedDetail = detailMap.get(item.row.expectedHtsNumber);
      const aiNormalization = aiNormalizationMap.get(item.row.queryId);
      return {
        auditId: `audit-${item.row.queryId}`,
        priorityScore: item.priorityScore,
        priorityFlags: item.priorityFlags,
        queryId: item.row.queryId,
        standardizedQuery: item.row.standardizedQuery,
        normalizedQuery: item.probe.normalizedQuery,
        aiNormalizedQuery: aiNormalization?.normalizedQuery || '',
        aiSearchPhrases: aiNormalization?.searchPhrases || [],
        aiHeadingHints: aiNormalization?.headingHints || [],
        aiIgnoreTerms: aiNormalization?.ignoreTerms || [],
        representativeDescription: item.row.representativeDescription,
        expectedHtsNumber: item.row.expectedHtsNumber,
        acceptableHtsNumbers: item.row.acceptableHtsNumbers,
        expectedChapter: item.row.expectedChapter,
        ambiguity: item.row.ambiguity,
        contributingStandardizedRows: item.row.contributingStandardizedRows,
        maxNoiseScore: item.row.maxNoiseScore,
        liveStatus: item.probe.status,
        liveLatencyMs: item.probe.latencyMs,
        liveTop1HtsNumber: top1?.htsNumber || '',
        liveTop1Description: top1?.description || '',
        liveTop10HtsNumbers: item.probe.top10.map((entry) => entry.htsNumber),
        liveExactTop1: Boolean(top1 && item.row.acceptableHtsNumbers.includes(top1.htsNumber)),
        liveExactTop10: item.probe.top10.some((entry) =>
          item.row.acceptableHtsNumbers.includes(entry.htsNumber),
        ),
        expectedHtsDescription: expectedDetail?.description || '',
        expectedHtsPath: (expectedDetail?.fullDescription || []).join(' > '),
        auditStatus: 'PENDING',
        auditedHtsNumber: '',
        auditedDescription: '',
        reviewerNotes: '',
      };
    });
  }

  private async probeSearch(query: string, limit: number): Promise<SearchProbeResult> {
    const startedAt = Date.now();
    try {
      const result = await this.searchService.searchWithStandardization(query, limit);
      return {
        status: 200,
        latencyMs: Date.now() - startedAt,
        normalizedQuery: String(result.standardizedQuery || query).trim(),
        top10: (result.results || []).slice(0, 10).map((item) => ({
          htsNumber: item.htsNumber,
          description: item.description,
        })),
      };
    } catch (error) {
      return {
        status: 500,
        latencyMs: Date.now() - startedAt,
        normalizedQuery: query,
        top10: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private computeStaticPriority(row: EvalRow): { score: number; flags: string[] } {
    const flags: string[] = [];
    let score = 0;
    const tokenCount = row.standardizedQuery.split(/\s+/).filter(Boolean).length;

    if (row.ambiguity === 'multi_label') {
      score += 45;
      flags.push('multi_label');
    }
    if (row.maxNoiseScore >= 2) {
      score += 20;
      flags.push('high_noise');
    } else if (row.maxNoiseScore === 1) {
      score += 10;
      flags.push('moderate_noise');
    }
    if (row.contributingStandardizedRows >= 3) {
      score += 20;
      flags.push('many_contributors');
    } else if (row.contributingStandardizedRows === 2) {
      score += 10;
      flags.push('multi_source');
    }
    if (tokenCount <= 3) {
      score += 15;
      flags.push('short_query');
    }
    if (tokenCount >= 10) {
      score += 10;
      flags.push('long_query');
    }
    if (['42', '61', '62', '64', '71', '85', '95'].includes(row.expectedChapter)) {
      score += 10;
      flags.push(`high_value_chapter_${row.expectedChapter}`);
    }

    return { score, flags };
  }

  private applyDynamicPriority(
    baseScore: number,
    baseFlags: string[],
    row: EvalRow,
    probe: SearchProbeResult,
  ): { score: number; flags: string[] } {
    const flags = [...baseFlags];
    let score = baseScore;
    const top1 = probe.top10[0]?.htsNumber || '';
    const exactTop10 = probe.top10.some((item) =>
      row.acceptableHtsNumbers.includes(item.htsNumber),
    );

    if (probe.error) {
      score += 40;
      flags.push('search_error');
    } else {
      if (!top1) {
        score += 35;
        flags.push('no_results');
      } else if (!row.acceptableHtsNumbers.includes(top1)) {
        score += 25;
        flags.push('top1_mismatch');
      } else {
        score -= 10;
        flags.push('top1_match');
      }
      if (!exactTop10) {
        score += 50;
        flags.push('top10_miss');
      }
      if (probe.latencyMs >= 1500) {
        score += 10;
        flags.push('slow_search');
      }
    }

    return { score, flags: [...new Set(flags)] };
  }

  private pickEvalRows(standardizedRows: StandardizedRow[], maxPerCode: number): EvalRow[] {
    const byCode = new Map<string, StandardizedRow[]>();
    for (const row of standardizedRows) {
      if (!byCode.has(row.canonicalHtsNumber)) {
        byCode.set(row.canonicalHtsNumber, []);
      }
      byCode.get(row.canonicalHtsNumber)!.push(row);
    }

    const selected = new Map<string, StandardizedRow>();
    for (const [code, rows] of [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const ordered = [...rows].sort((a, b) => {
        if (a.noiseScore !== b.noiseScore) {
          return a.noiseScore - b.noiseScore;
        }
        if (a.standardizedQuery.length !== b.standardizedQuery.length) {
          return a.standardizedQuery.length - b.standardizedQuery.length;
        }
        return this.md5(`${code}:${a.standardizedQuery}`).localeCompare(
          this.md5(`${code}:${b.standardizedQuery}`),
        );
      });

      const picks: StandardizedRow[] = [];
      if (ordered[0]) picks.push(ordered[0]);
      const noisy = [...ordered]
        .reverse()
        .find((row) => row.standardizedQuery !== picks[0]?.standardizedQuery);
      if (noisy) picks.push(noisy);
      const longest = [...ordered]
        .sort((a, b) => b.standardizedQuery.length - a.standardizedQuery.length)
        .find((row) => !picks.some((item) => item.standardizedQuery === row.standardizedQuery));
      if (longest) picks.push(longest);
      for (const row of ordered) {
        if (picks.length >= maxPerCode) break;
        if (!picks.some((item) => item.standardizedQuery === row.standardizedQuery)) {
          picks.push(row);
        }
      }
      for (const row of picks.slice(0, maxPerCode)) {
        selected.set(row.standardizedQuery, row);
      }
    }

    const grouped = new Map<string, StandardizedRow[]>();
    for (const row of standardizedRows) {
      if (!selected.has(row.standardizedQuery)) continue;
      if (!grouped.has(row.standardizedQuery)) {
        grouped.set(row.standardizedQuery, []);
      }
      grouped.get(row.standardizedQuery)!.push(row);
    }

    const evalRows: EvalRow[] = [];
    let sequence = 1;
    for (const [query, rows] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (this.isLowInformationQuery(query)) {
        continue;
      }
      const acceptableHtsNumbers = [...new Set(rows.map((row) => row.canonicalHtsNumber))].sort();
      const expectedHtsNumber = acceptableHtsNumbers[0];
      const representative = [...rows].sort((a, b) =>
        a.noiseScore === b.noiseScore
          ? a.originalDescription.length - b.originalDescription.length
          : a.noiseScore - b.noiseScore,
      )[0];

      evalRows.push({
        queryId: `cc-${String(sequence).padStart(5, '0')}`,
        standardizedQuery: query,
        representativeDescription: representative.originalDescription,
        expectedHtsNumber,
        acceptableHtsNumbers,
        expectedChapter: expectedHtsNumber.slice(0, 2),
        ambiguity: acceptableHtsNumbers.length > 1 ? 'multi_label' : 'single_label',
        contributingStandardizedRows: rows.length,
        maxNoiseScore: Math.max(...rows.map((row) => row.noiseScore)),
      });
      sequence++;
    }

    return evalRows;
  }

  private assessRowQuality(
    row: StandardizedRow,
    detail: HtsDetailLike | undefined,
  ): { qualityFlags: string[]; qualityScore: number; evalEligible: boolean } {
    if (!detail) {
      return {
        qualityFlags: ['missing_hts_detail'],
        qualityScore: 0,
        evalEligible: false,
      };
    }

    const queryTokens = this.extractTokens(row.standardizedQuery);
    const detailTokens = new Set(
      this.extractTokens(
        `${detail.description || ''} ${(detail.fullDescription || []).join(' ')}`.trim(),
      ),
    );
    const expandedQueryTokens = this.buildExpandedTokenSet(queryTokens);
    const overlapTokens = [...expandedQueryTokens].filter((token) => detailTokens.has(token));
    const overlapNonMaterialCount = overlapTokens.filter(
      (token) => !this.materialTokens.has(token),
    ).length;
    const nonMaterialTokens = queryTokens.filter((token) => !this.materialTokens.has(token));
    const hasArticleToken = queryTokens.some((token) => this.articleTokens.has(token));
    const onlyGenericVariantTokens =
      nonMaterialTokens.length > 0 &&
      nonMaterialTokens.every((token) => this.genericVariantTokens.has(token));

    const qualityFlags: string[] = [];
    if (queryTokens.length < 2) qualityFlags.push('low_token_count');
    if (this.isMaterialOnlyQuery(queryTokens)) qualityFlags.push('material_only');
    if (this.hasModelNumberPattern(row.standardizedQuery)) qualityFlags.push('model_number');
    if (overlapNonMaterialCount === 0) qualityFlags.push('no_semantic_overlap');
    if (!hasArticleToken && queryTokens.length <= 4 && overlapNonMaterialCount < 2) {
      qualityFlags.push('weak_catalog_fragment');
    }
    if (onlyGenericVariantTokens) qualityFlags.push('variant_only');

    let qualityScore = 100;
    for (const flag of qualityFlags) {
      switch (flag) {
        case 'low_token_count':
        case 'material_only':
        case 'no_semantic_overlap':
          qualityScore -= 45;
          break;
        case 'model_number':
          qualityScore -= 25;
          break;
        case 'weak_catalog_fragment':
        case 'variant_only':
          qualityScore -= 30;
          break;
        default:
          qualityScore -= 10;
      }
    }
    qualityScore = Math.max(0, qualityScore);

    const evalEligible =
      queryTokens.length >= 2 &&
      !this.isMaterialOnlyQuery(queryTokens) &&
      overlapNonMaterialCount >= 1 &&
      !(this.hasModelNumberPattern(row.standardizedQuery) && overlapNonMaterialCount < 2) &&
      !(!hasArticleToken && queryTokens.length <= 4 && overlapNonMaterialCount < 2) &&
      !onlyGenericVariantTokens &&
      qualityScore >= 60;

    return { qualityFlags, qualityScore, evalEligible };
  }

  private isEvalEligible(query: string, detail: HtsDetailLike | undefined): boolean {
    if (!detail) {
      return false;
    }
    const queryTokens = this.extractTokens(query);
    if (queryTokens.length < 2 || this.isMaterialOnlyQuery(queryTokens)) {
      return false;
    }
    const detailTokens = new Set(
      this.extractTokens(
        `${detail.description || ''} ${(detail.fullDescription || []).join(' ')}`.trim(),
      ),
    );
    const expandedQueryTokens = this.buildExpandedTokenSet(queryTokens);
    const overlapTokens = [...expandedQueryTokens].filter((token) => detailTokens.has(token));
    const overlapCount = overlapTokens.length;
    const overlapNonMaterialCount = overlapTokens.filter(
      (token) => !this.materialTokens.has(token),
    ).length;
    const hasArticleToken = queryTokens.some((token) => this.articleTokens.has(token));
    const nonMaterialCount = queryTokens.filter(
      (token) => !this.materialTokens.has(token),
    ).length;

    if (overlapCount >= 2) return true;
    if (overlapNonMaterialCount >= 1 && hasArticleToken) return true;
    return overlapNonMaterialCount >= 1 && nonMaterialCount >= 3;
  }

  private extractTokens(value: string): string[] {
    return value
      .toLowerCase()
      .replace(/\d+/g, ' ')
      .split(/[^a-z]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !this.stopWords.has(token));
  }

  private buildExpandedTokenSet(tokens: string[]): Set<string> {
    const expanded = new Set<string>();
    for (const token of tokens) {
      expanded.add(token);
      for (const synonym of this.tokenSynonyms[token] || []) {
        expanded.add(synonym);
      }
    }
    return expanded;
  }

  private hasModelNumberPattern(query: string): boolean {
    return /\b[a-z]*\d[a-z0-9-]*\b/i.test(query);
  }

  private isMaterialOnlyQuery(tokens: string[]): boolean {
    return tokens.filter((token) => !this.materialTokens.has(token)).length === 0;
  }

  private detectNoiseFlags(originalDescription: string): string[] {
    const flags: string[] = [];
    if (/<[^>]+>/.test(originalDescription)) flags.push('html');
    if (/\b\d+(?:[.,]\d+)?\s*(?:g|gram|grams|kg|oz|ounce|ounces|lb|lbs|pound|pounds|ml|cl|l|liter|litre)\b/i.test(originalDescription)) {
      flags.push('measure');
    }
    if (/\b\d+\s*(?:count|ct|pk|pcs?|pieces?|servings?)\b/i.test(originalDescription)) {
      flags.push('count');
    }
    if (/[\/|]/.test(originalDescription)) flags.push('options');
    return flags;
  }

  private standardizeDescription(value: string): string {
    return this.dedupeAdjacentSegments(
      this.stripHtml(value)
        .replace(/[–—]/g, '-')
        .replace(/\s*\/\s*/g, ' / ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }

  private standardizeQuery(value: string): string {
    const normalized = this.standardizeDescription(value)
      .toLowerCase()
      .replace(/\b\d+\s*-\s*\d+\s*(?:months?|mos?|years?|yrs?)\b/gi, ' ')
      .replace(/\b\d+\s*(?:months?|mos?|years?|yrs?)\b/gi, ' ')
      .replace(/^\s*\d+\s*(?:x|pairs?|pcs?|pieces?)\b/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?(?:mm|cm|m|ft|in|inch|inches|yd|yard|yards)?\b/gi, ' ')
      .replace(/\((?:[^)]*\b\d+(?:[.,]\d+)?\s*(?:g|gram|grams|kg|oz|ounce|ounces|lb|lbs|pound|pounds|ml|cl|l|liter|litre|count|ct|pk|pcs?|pieces?|servings?)\b[^)]*)\)/gi, ' ')
      .replace(/\b(?:box|pack|set|bundle)\s+of\s+\d+\b/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*%\s*/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|gram|grams|kg|oz|ounce|ounces|lb|lbs|pound|pounds|ml|cl|l|liter|litre|count|ct|pk|pcs?|pieces?|servings?)\b/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:mm|cm|m|meter|meters|ft|feet|inch|inches|in|yd|yds|yard|yards)\b/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)?\b/gi, ' ')
      .replace(/\b(?:whole bean|ground|grind size|roast level)\b\s*:\s*/gi, ' ')
      .replace(/["“”]/g, ' ')
      .replace(/[&+]/g, ' and ')
      .replace(/[^a-z0-9%/\-.,' ]+/g, ' ')
      .replace(/\s*\/\s*/g, ' ')
      .replace(/\s*-\s*/g, ' ')
      .replace(/^\d+\s+(?=[a-z])/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[,.' -]+|[,.' -]+$/g, '')
      .trim();

    const tokens = normalized.split(' ').filter(Boolean).filter((token) => !/^\d+(?:[.,]\d+)?$/.test(token));
    while (tokens.length > 0 && this.boundaryStopwords.has(tokens[0])) tokens.shift();
    while (tokens.length > 0 && this.boundaryStopwords.has(tokens[tokens.length - 1])) tokens.pop();

    const deduped: string[] = [];
    for (const token of tokens) {
      if (deduped[deduped.length - 1] !== token) {
        deduped.push(token);
      }
    }
    return deduped.join(' ');
  }

  private isLowInformationQuery(value: string): boolean {
    const query = value.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!query || query.length < 4) return true;
    if (tokens.length === 1 && /^\d+$/.test(tokens[0])) return true;
    return [
      'book', 'books', 'card', 'cards', 'document', 'gift', 'item', 'magazine',
      'photo', 'product', 'sample', 'samples', 'sticker', 'stickers',
    ].includes(query);
  }

  private normalizeHtsDigits(value: string): string {
    return String(value || '').replace(/\D/g, '').slice(0, 10);
  }

  private formatHtsNumber(value: string): string {
    if (value.length !== 10) {
      return value;
    }
    return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}.${value.slice(8, 10)}`;
  }

  private decodeHtmlEntities(value: string): string {
    return value
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }

  private stripHtml(value: string): string {
    return this.decodeHtmlEntities(String(value || ''))
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private dedupeAdjacentSegments(value: string): string {
    const parts = value
      .split(/\s+-\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length <= 1) return value;
    const deduped: string[] = [];
    for (const part of parts) {
      if (deduped[deduped.length - 1] !== part) {
        deduped.push(part);
      }
    }
    return deduped.join(' - ');
  }

  private md5(value: string): string {
    return createHash('md5').update(value).digest('hex');
  }

  private async mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    worker: (value: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    let cursor = 0;
    const results = new Array<R>(values.length);
    async function run(this: LookupDatasetCurationJobService): Promise<void> {
      while (true) {
        const current = cursor++;
        if (current >= values.length) return;
        results[current] = await worker(values[current], current);
      }
    }
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, () =>
        run.call(this),
      ),
    );
    return results;
  }

  private toStandardizedCsv(rows: StandardizedRow[]): string {
    return csvStringify(
      rows.map((row) => ({
        query_id: row.queryId,
        canonical_hts_number: row.canonicalHtsNumber,
        canonical_hts_digits: row.canonicalHtsDigits,
        original_description: row.originalDescription,
        standardized_description: row.standardizedDescription,
        standardized_query: row.standardizedQuery,
        noise_flags: row.noiseFlags.join('|'),
        noise_score: row.noiseScore,
        quality_flags: row.qualityFlags.join('|'),
        quality_score: row.qualityScore,
        eval_eligible: row.evalEligible,
      })),
      { header: true },
    );
  }

  private toRejectedCsv(rows: StandardizedRow[]): string {
    return this.toStandardizedCsv(rows);
  }

  private toEvalCsv(rows: EvalRow[]): string {
    return csvStringify(
      rows.map((row) => ({
        query_id: row.queryId,
        standardized_query: row.standardizedQuery,
        representative_description: row.representativeDescription,
        expected_hts_number: row.expectedHtsNumber,
        acceptable_hts_numbers: row.acceptableHtsNumbers.join('|'),
        expected_chapter: row.expectedChapter,
        ambiguity: row.ambiguity,
        contributing_standardized_rows: row.contributingStandardizedRows,
        max_noise_score: row.maxNoiseScore,
      })),
      { header: true },
    );
  }

  private toAuditCsv(rows: AuditRow[]): string {
    return csvStringify(
      rows.map((row) => ({
        audit_id: row.auditId,
        priority_score: row.priorityScore,
        priority_flags: row.priorityFlags.join('|'),
        query_id: row.queryId,
        standardized_query: row.standardizedQuery,
        normalized_query: row.normalizedQuery,
        ai_normalized_query: row.aiNormalizedQuery,
        ai_search_phrases: row.aiSearchPhrases.join('|'),
        ai_heading_hints: row.aiHeadingHints.join('|'),
        ai_ignore_terms: row.aiIgnoreTerms.join('|'),
        representative_description: row.representativeDescription,
        expected_hts_number: row.expectedHtsNumber,
        acceptable_hts_numbers: row.acceptableHtsNumbers.join('|'),
        expected_chapter: row.expectedChapter,
        ambiguity: row.ambiguity,
        contributing_standardized_rows: row.contributingStandardizedRows,
        max_noise_score: row.maxNoiseScore,
        live_status: row.liveStatus,
        live_latency_ms: row.liveLatencyMs,
        live_top1_hts_number: row.liveTop1HtsNumber,
        live_top1_description: row.liveTop1Description,
        live_top10_hts_numbers: row.liveTop10HtsNumbers.join('|'),
        live_exact_top1: row.liveExactTop1,
        live_exact_top10: row.liveExactTop10,
        expected_hts_description: row.expectedHtsDescription,
        expected_hts_path: row.expectedHtsPath,
        audit_status: row.auditStatus,
        audited_hts_number: row.auditedHtsNumber,
        audited_description: row.auditedDescription,
        reviewer_notes: row.reviewerNotes,
      })),
      { header: true },
    );
  }
}
