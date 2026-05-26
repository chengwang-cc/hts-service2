import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, type Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { TelemetryService } from '../../observability/telemetry.service';
import {
  BrokerOutreachDiscoveryResultEntity,
  BrokerOutreachDiscoveryRunEntity,
  BrokerOutreachInviteEntity,
} from '../entities';

/**
 * Retention sweep for broker-outreach. Three policies:
 *
 *   - Invites whose expiresAt has passed and status is still
 *     `created|sent|opened` are flipped to `expired` (terminal).
 *   - Discovery runs older than OUTREACH_DISCOVERY_RUN_RETENTION_DAYS
 *     are deleted (cascades to per-result rows).
 *   - Suppression entries older than OUTREACH_SUPPRESSION_RETENTION_DAYS
 *     would be deleted — but suppression is in-process for now, so we
 *     only emit a counter for the operator.
 *
 * Designed to be called from a daily pg-boss cron. Safe to call inline
 * for tests — every step is idempotent.
 */
export interface RetentionSweepResult {
  expiredInvites: number;
  deletedRuns: number;
  deletedResults: number;
}

@Injectable()
export class BrokerOutreachRetentionService {
  private readonly logger = new Logger(BrokerOutreachRetentionService.name);

  constructor(
    @InjectRepository(BrokerOutreachInviteEntity)
    private readonly invites: Repository<BrokerOutreachInviteEntity>,
    @InjectRepository(BrokerOutreachDiscoveryRunEntity)
    private readonly runs: Repository<BrokerOutreachDiscoveryRunEntity>,
    @InjectRepository(BrokerOutreachDiscoveryResultEntity)
    private readonly results: Repository<BrokerOutreachDiscoveryResultEntity>,
    @Optional() private readonly audit: AuditService | null = null,
    @Optional() private readonly telemetry: TelemetryService | null = null,
  ) {}

  async sweep(now: Date = new Date()): Promise<RetentionSweepResult> {
    const expiredInvites = await this.expireInvites(now);
    const { deletedRuns, deletedResults } = await this.purgeDiscoveryRuns(now);
    this.logger.log(
      `outreach.retention.sweep expiredInvites=${expiredInvites} deletedRuns=${deletedRuns} deletedResults=${deletedResults}`,
    );
    if (this.audit && (expiredInvites > 0 || deletedRuns > 0)) {
      await this.audit.record({
        eventType: 'broker_outreach.retention_sweep',
        actorUserId: 'retention-worker',
        resourceType: 'broker_outreach',
        resourceId: null,
        source: 'broker-outreach',
        metadata: { expiredInvites, deletedRuns, deletedResults },
      });
    }
    if (this.telemetry) {
      this.telemetry.setGauge(
        'broker_outreach_retention_last_run_timestamp',
        {},
        Math.floor(now.getTime() / 1000),
      );
      if (expiredInvites > 0) {
        this.telemetry.countEvent(
          'broker_outreach_invites_total',
          { status: 'expired' },
          expiredInvites,
        );
      }
    }
    return { expiredInvites, deletedRuns, deletedResults };
  }

  private async expireInvites(now: Date): Promise<number> {
    // Use querybuilder so we can express the IN status filter alongside
    // the time predicate in one statement.
    const result = await this.invites
      .createQueryBuilder()
      .update()
      .set({ status: 'expired' })
      .where('expiresAt < :now', { now })
      .andWhere('status IN (:...openStatuses)', {
        openStatuses: ['created', 'sent', 'opened'],
      })
      .execute();
    return result.affected ?? 0;
  }

  private async purgeDiscoveryRuns(
    now: Date,
  ): Promise<{ deletedRuns: number; deletedResults: number }> {
    const days = Number(
      process.env.OUTREACH_DISCOVERY_RUN_RETENTION_DAYS ?? 30,
    );
    if (!Number.isFinite(days) || days <= 0) {
      return { deletedRuns: 0, deletedResults: 0 };
    }
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const stale = await this.runs.find({
      where: { createdAt: LessThan(cutoff) },
      take: 500,
    });
    if (!stale.length) {
      return { deletedRuns: 0, deletedResults: 0 };
    }
    const ids = stale.map((r) => r.id);
    const deletedResults = await this.results
      .createQueryBuilder()
      .delete()
      .where('runId IN (:...ids)', { ids })
      .execute();
    await this.runs.delete(ids);
    return {
      deletedRuns: ids.length,
      deletedResults: deletedResults.affected ?? 0,
    };
  }
}
