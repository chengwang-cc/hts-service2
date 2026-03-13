import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LookupConversationFeedbackEntity } from '../../lookup/entities/lookup-conversation-feedback.entity';
import * as fs from 'fs';
import * as path from 'path';

export interface RuleStats {
  ruleId: string;
  total: number;
  failures: number;
  failureRate: number;
  flagged: boolean;
}

export interface ZeroRuleFailure {
  queryText: string;
  count: number;
}

export interface LookupRuleAnalysisReport {
  generatedAt: string;
  windowDays: number;
  totalFeedback: number;
  withMatchedRules: number;
  withoutMatchedRules: number;
  perRuleStats: RuleStats[];
  zeroRuleFailures: ZeroRuleFailure[];
  jsonPath: string | null;
}

@Injectable()
export class LookupRuleAnalysisService {
  private readonly logger = new Logger(LookupRuleAnalysisService.name);

  /** Rules with failure rate above this threshold are flagged for human review. */
  private readonly FAILURE_RATE_THRESHOLD = 0.05;

  constructor(
    @InjectRepository(LookupConversationFeedbackEntity)
    private readonly feedbackRepository: Repository<LookupConversationFeedbackEntity>,
  ) {}

  async analyzeRules(options: {
    windowDays?: number;
    outputDir?: string;
  } = {}): Promise<LookupRuleAnalysisReport> {
    const windowDays = options.windowDays ?? 7;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    this.logger.log(
      `Analyzing intent rule effectiveness over last ${windowDays} days (since ${since.toISOString()})`,
    );

    const rows = await this.feedbackRepository
      .createQueryBuilder('f')
      .where('f.createdAt >= :since', { since })
      .andWhere('f.metadata IS NOT NULL')
      .select([
        'f.id',
        'f.isCorrect',
        'f.metadata',
      ])
      .getMany();

    const totalFeedback = rows.length;
    let withMatchedRules = 0;
    let withoutMatchedRules = 0;

    // per-rule accumulators: { total, failures }
    const ruleAccum = new Map<string, { total: number; failures: number }>();
    // zero-rule failure queries: { queryText → count }
    const zeroRuleFailures = new Map<string, number>();

    for (const row of rows) {
      const meta = row.metadata;
      const matchedRuleIds: string[] = Array.isArray(meta?.matchedRuleIds)
        ? meta.matchedRuleIds
        : [];
      const queryText: string = typeof meta?.queryText === 'string' ? meta.queryText : '';

      if (matchedRuleIds.length === 0) {
        withoutMatchedRules++;
        if (!row.isCorrect && queryText) {
          zeroRuleFailures.set(queryText, (zeroRuleFailures.get(queryText) ?? 0) + 1);
        }
        continue;
      }

      withMatchedRules++;
      for (const ruleId of matchedRuleIds) {
        const acc = ruleAccum.get(ruleId) ?? { total: 0, failures: 0 };
        acc.total++;
        if (!row.isCorrect) {
          acc.failures++;
        }
        ruleAccum.set(ruleId, acc);
      }
    }

    const perRuleStats: RuleStats[] = Array.from(ruleAccum.entries())
      .map(([ruleId, acc]) => {
        const failureRate = acc.total > 0 ? acc.failures / acc.total : 0;
        return {
          ruleId,
          total: acc.total,
          failures: acc.failures,
          failureRate,
          flagged: failureRate > this.FAILURE_RATE_THRESHOLD,
        };
      })
      .sort((a, b) => b.failureRate - a.failureRate);

    const zeroRuleFailureList: ZeroRuleFailure[] = Array.from(zeroRuleFailures.entries())
      .map(([queryText, count]) => ({ queryText, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50); // top 50 unrecognized failure queries

    const report: LookupRuleAnalysisReport = {
      generatedAt: new Date().toISOString(),
      windowDays,
      totalFeedback,
      withMatchedRules,
      withoutMatchedRules,
      perRuleStats,
      zeroRuleFailures: zeroRuleFailureList,
      jsonPath: null,
    };

    // Write JSON report if outputDir provided
    if (options.outputDir) {
      const date = new Date().toISOString().slice(0, 10);
      const time = new Date().toTimeString().slice(0, 5).replace(':', '');
      const outputPath = path.join(options.outputDir, `${date}-${time}_lookup-rule-analysis.json`);
      try {
        fs.mkdirSync(options.outputDir, { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
        report.jsonPath = outputPath;
        this.logger.log(`Rule analysis report written to ${outputPath}`);
      } catch (err) {
        this.logger.warn(
          `Failed to write rule analysis report: ${(err as Error).message}`,
        );
      }
    }

    return report;
  }
}
