import { Injectable, Logger } from '@nestjs/common';
import { LookupRuleAnalysisService } from '../services/lookup-rule-analysis.service';

interface LookupRuleAnalysisJobData {
  windowDays?: number;
  outputDir?: string;
}

@Injectable()
export class LookupRuleAnalysisJobHandler {
  private readonly logger = new Logger(LookupRuleAnalysisJobHandler.name);

  constructor(private readonly analysisService: LookupRuleAnalysisService) {}

  async execute(job: { id?: string; data?: LookupRuleAnalysisJobData }): Promise<void> {
    const data = job.data || {};
    const windowDays =
      Number.isFinite(data.windowDays) ? Math.max(1, Math.floor(data.windowDays as number)) : 7;
    const outputDir = data.outputDir || process.env.HTS_RULE_ANALYSIS_OUTPUT_DIR;

    this.logger.log(
      `Starting lookup rule analysis job id=${job.id || 'unknown'} windowDays=${windowDays}`,
    );

    const report = await this.analysisService.analyzeRules({ windowDays, outputDir });

    const flaggedRules = report.perRuleStats.filter((r) => r.flagged);
    const zeroRuleCount = report.zeroRuleFailures.length;

    this.logger.log(
      `Rule analysis complete: total=${report.totalFeedback} withRules=${report.withMatchedRules}` +
        ` withoutRules=${report.withoutMatchedRules}` +
        ` flaggedRules=${flaggedRules.length}` +
        ` zeroRuleFailureQueries=${zeroRuleCount}` +
        (report.jsonPath ? ` json=${report.jsonPath}` : ''),
    );

    if (flaggedRules.length > 0) {
      this.logger.warn(
        `INTENT RULES FLAGGED FOR REVIEW (failure rate > ${(0.05 * 100).toFixed(0)}%):\n` +
          flaggedRules
            .map(
              (r) =>
                `  ${r.ruleId}: ${r.failures}/${r.total} failures (${(r.failureRate * 100).toFixed(1)}%)`,
            )
            .join('\n'),
      );
    }

    if (zeroRuleCount > 0) {
      this.logger.warn(
        `TOP ZERO-RULE FAILURE QUERIES (no intent rule fired, result was wrong):\n` +
          report.zeroRuleFailures
            .slice(0, 10)
            .map((q) => `  [×${q.count}] "${q.queryText}"`)
            .join('\n'),
      );
    }
  }
}
