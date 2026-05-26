import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { TelemetryService } from './telemetry.service';
import { KnowledgeCardEntity } from '../knowledgebase-cards/entities/knowledge-card.entity';
import { EcommerceHandoffEntity } from '../ecommerce-handoff/entities/ecommerce-handoff.entity';

/**
 * Periodically computes the "current count" gauges that aren't derivable
 * from a single mutation:
 *
 *   - knowledge_cards_pending_review_count
 *   - knowledge_cards_active_count
 *   - ecommerce_handoff_state_count{state="<state>"}
 *
 * Tick cadence is governed by OBSERVABILITY_GAUGE_REFRESH_MS (default
 * 60s). Disable by setting OBSERVABILITY_GAUGE_REFRESH_MS=0.
 *
 * The job runs at boot and on each tick. Each refresh is best-effort —
 * failures are logged but don't crash the service.
 */
@Injectable()
export class ObservabilityGaugeRefresherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ObservabilityGaugeRefresherService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly telemetry: TelemetryService,
    @Optional()
    @InjectRepository(KnowledgeCardEntity)
    private readonly cards: Repository<KnowledgeCardEntity> | null = null,
    @Optional()
    @InjectRepository(EcommerceHandoffEntity)
    private readonly handoffs: Repository<EcommerceHandoffEntity> | null = null,
  ) {}

  async onModuleInit(): Promise<void> {
    const intervalMs = Number(
      process.env.OBSERVABILITY_GAUGE_REFRESH_MS ?? 60_000,
    );
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      this.logger.log('gauge refresher disabled (interval <= 0)');
      return;
    }
    await this.refreshOnce();
    this.timer = setInterval(() => {
      this.refreshOnce().catch((e) =>
        this.logger.warn(`gauge refresh failed: ${e?.message ?? e}`),
      );
    }, intervalMs);
    // Prevent the timer from blocking process shutdown.
    this.timer.unref?.();
    this.logger.log(`gauge refresher started (interval=${intervalMs}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One pass. Exposed so tests can invoke deterministically.
   */
  async refreshOnce(): Promise<void> {
    await Promise.all([this.refreshKnowledgeCards(), this.refreshHandoffs()]);
  }

  private async refreshKnowledgeCards(): Promise<void> {
    if (!this.cards) return;
    try {
      const [pending, active] = await Promise.all([
        this.cards.count({ where: { status: 'pending_review' } }),
        this.cards.count({ where: { status: 'active' } }),
      ]);
      this.telemetry.setGauge(
        'knowledge_cards_pending_review_count',
        {},
        pending,
      );
      this.telemetry.setGauge('knowledge_cards_active_count', {}, active);
    } catch (e: any) {
      this.logger.warn(
        `knowledge card gauge refresh failed: ${e?.message ?? e}`,
      );
    }
  }

  private async refreshHandoffs(): Promise<void> {
    if (!this.handoffs) return;
    try {
      const rows = await this.handoffs
        .createQueryBuilder('h')
        .select('h.state', 'state')
        .addSelect('COUNT(*)', 'count')
        .groupBy('h.state')
        .getRawMany<{ state: string; count: string }>();
      const seen = new Set<string>();
      for (const row of rows) {
        const state = row.state || 'unknown';
        seen.add(state);
        this.telemetry.setGauge(
          'ecommerce_handoff_state_count',
          { state },
          Number(row.count),
        );
      }
      // Ensure the alert rules that watch the canonical states see a
      // value, even when zero rows exist — keeps Grafana happy.
      const canonical = [
        'classification_needed',
        'landed_cost_ready',
        'broker_review_required',
        'broker_released',
        'fulfillment_blocked',
      ];
      for (const state of canonical) {
        if (!seen.has(state)) {
          this.telemetry.setGauge(
            'ecommerce_handoff_state_count',
            { state },
            0,
          );
        }
      }
    } catch (e: any) {
      this.logger.warn(
        `ecommerce handoff gauge refresh failed: ${e?.message ?? e}`,
      );
    }
  }
}
