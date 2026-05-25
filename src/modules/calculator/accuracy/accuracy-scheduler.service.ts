import { Injectable, Logger } from '@nestjs/common';
import { TariffSourceFreshnessService } from './tariff-source-freshness.service';
import { EvidenceCoverageService } from './evidence-coverage.service';
import type { SourceFreshnessRecord } from './tariff-source-freshness.types';
import type { ComponentEvidenceRecord } from './evidence-coverage.service';

/**
 * AccuracySchedulerService
 *
 * The orchestrator the plan calls for in Phase 6. On each tick (driven by
 * a scheduled job or admin-triggered manual run) it:
 *
 *   1. Asks the freshness service which source packs need refresh.
 *   2. Asks the evidence service which components fail the rollout gate.
 *   3. Emits a `ReviewTask[]` queue for the admin UI.
 *
 * Real ingestion + persistence are dependency-injected via the
 * `AccuracyDataProvider` interface so this service is testable without a
 * database. A follow-up wires a TypeORM-backed provider; for now consumers
 * can plug in an in-memory provider for development.
 */

export interface AccuracyDataProvider {
  /** Read the current freshness records (one per source pack). */
  loadFreshnessRecords(): Promise<SourceFreshnessRecord[]>;
  /** Read the current evidence records (one per active component). */
  loadEvidenceRecords(): Promise<ComponentEvidenceRecord[]>;
}

export type ReviewTaskKind =
  | 'refresh_source'
  | 'evidence_gap'
  | 'rollout_block';

export interface ReviewTask {
  id: string;
  kind: ReviewTaskKind;
  /** Priority: 0 = lowest, 100 = highest. */
  priority: number;
  /** Short human title for the admin queue. */
  title: string;
  /** Free-text body for review context. */
  body: string;
  /** Optional reference to the affected source / component. */
  references: {
    sourceId?: string;
    componentId?: string;
    chapter99HtsCode?: string | null;
  };
}

export interface AccuracyTickResult {
  generatedAt: string;
  freshness: {
    total: number;
    needsRefresh: number;
    blocksRollout: number;
  };
  evidence: {
    total: number;
    incomplete: number;
    rolloutBlocked: number;
    coveragePercentage: number;
  };
  reviewTasks: ReviewTask[];
}

@Injectable()
export class AccuracySchedulerService {
  private readonly logger = new Logger(AccuracySchedulerService.name);

  constructor(
    private readonly freshness: TariffSourceFreshnessService,
    private readonly coverage: EvidenceCoverageService,
  ) {}

  async tick(
    provider: AccuracyDataProvider,
    now: Date = new Date(),
  ): Promise<AccuracyTickResult> {
    const [freshnessRecords, evidenceRecords] = await Promise.all([
      provider.loadFreshnessRecords(),
      provider.loadEvidenceRecords(),
    ]);
    const freshnessReports = this.freshness.scoreBatch(freshnessRecords, now);
    const freshnessSummary = this.freshness.summarize(freshnessReports);
    const coverageReports = this.coverage.reportBatch(evidenceRecords);
    const coverageSummary = this.coverage.summarize(coverageReports);

    const tasks: ReviewTask[] = [];

    for (const r of freshnessSummary.needsRefresh) {
      tasks.push({
        id: `freshness:${r.sourceId}`,
        kind: r.blocksRollout ? 'rollout_block' : 'refresh_source',
        priority: r.blocksRollout ? 95 : 60,
        title: `${r.label} is ${r.status}`,
        body: `Source ${r.sourceId} (${r.kind}) is ${r.status} (${r.ageDays ?? '?'} days). Affects ${r.dependentComponentCount} active components.`,
        references: { sourceId: r.sourceId },
      });
    }

    for (const c of coverageReports) {
      if (c.rolloutAllowed) continue;
      tasks.push({
        id: `evidence:${c.componentId}`,
        kind: 'rollout_block',
        priority: 80,
        title: `Evidence gap: ${c.programFamily} component ${c.componentId}`,
        body: `Missing evidence kinds: ${c.missing.join(', ') || 'none'}. Rollout blocked until backfilled.`,
        references: {
          componentId: c.componentId,
          chapter99HtsCode: c.chapter99HtsCode ?? null,
        },
      });
    }

    tasks.sort((a, b) => b.priority - a.priority);

    const result: AccuracyTickResult = {
      generatedAt: now.toISOString(),
      freshness: {
        total: freshnessReports.length,
        needsRefresh: freshnessSummary.needsRefresh.length,
        blocksRollout: freshnessSummary.blocksRollout.length,
      },
      evidence: {
        total: coverageReports.length,
        incomplete: coverageSummary.incomplete,
        rolloutBlocked: coverageSummary.rolloutBlocked,
        coveragePercentage: coverageSummary.coveragePercentage,
      },
      reviewTasks: tasks,
    };

    this.logger.log(
      `accuracy.tick total_sources=${result.freshness.total} ` +
        `needs_refresh=${result.freshness.needsRefresh} ` +
        `blocks_rollout=${result.freshness.blocksRollout} ` +
        `coverage_pct=${result.evidence.coveragePercentage} ` +
        `review_tasks=${tasks.length}`,
    );

    return result;
  }
}
