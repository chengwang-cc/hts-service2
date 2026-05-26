import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';
import { ExceptionRuleRegistry } from '../../exception-rules/exception-rule.registry';
import { KnowledgeCardEntity } from '../entities/knowledge-card.entity';
import {
  CardUpdatedJobData,
  KB_CARD_UPDATED_QUEUE,
  KnowledgeCardService,
} from './knowledge-card.service';
import { RuleReviewAlertService } from './rule-review-alert.service';
import { AlertAdvisoryService } from './alert-advisory.service';
import { QueueService } from '../../queue/queue.service';

/**
 * KnowledgeCardChangeDetectorService (Phase 8, P8.T10).
 *
 * Subscribes to `KnowledgeCardService` change events at boot and opens
 * a `RuleReviewAlert` for every ExceptionRule whose
 * `knowledgeCardKeys` includes the changed cardKey.
 *
 * Reuses the reverse-index already built in `ExceptionRuleRegistry`
 * (Phase 1). No extra index storage; lookups are O(1) per card.
 *
 * M5 fix (2026-05-27): when `ALERT_ADVISORY_ENABLED=true`, also
 * generates an AI advisory blob and attaches it to the alert. Off by
 * default — the no-op delegate returns null and the attach is skipped.
 *
 * L5 fix (2026-05-27): boot integrity check is now a single `In([...])`
 * query instead of N×`findActive` calls. ~150 sequential DB queries →
 * 1 batched query.
 */
@Injectable()
export class KnowledgeCardChangeDetectorService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeCardChangeDetectorService.name);
  private readonly advisoryEnabled =
    process.env.ALERT_ADVISORY_ENABLED === 'true';
  private readonly viaQueue =
    process.env.KB_CARD_EVENTS_VIA_QUEUE === 'true';

  constructor(
    private readonly cards: KnowledgeCardService,
    private readonly alerts: RuleReviewAlertService,
    private readonly registry: ExceptionRuleRegistry,
    private readonly advisory: AlertAdvisoryService,
    // Direct repo access for the batched boot integrity check (L5) and
    // for re-fetching cards when consuming the pg-boss event (M4).
    @Optional()
    @InjectRepository(KnowledgeCardEntity)
    private readonly cardRepo?: Repository<KnowledgeCardEntity>,
    @Optional() private readonly queue?: QueueService,
  ) {}

  onModuleInit(): void {
    if (this.viaQueue && this.queue) {
      void this.queue.registerHandler(KB_CARD_UPDATED_QUEUE, async (job) =>
        this.handleQueuedCardUpdate(job.data as CardUpdatedJobData),
      );
      this.logger.log(
        `KB_CARD_EVENTS_VIA_QUEUE=true — subscribing to "${KB_CARD_UPDATED_QUEUE}" via pg-boss (cross-pod safe)`,
      );
    } else {
      this.cards.onCardChanged(async (event) => {
        await this.onCardChanged(event);
      });
    }
    void this.bootIntegrityCheck();
    if (this.advisoryEnabled) {
      this.logger.log(
        'ALERT_ADVISORY_ENABLED=true — advisory will be generated for new alerts ' +
          `(provider: ${this.advisory.constructor.name})`,
      );
    }
  }

  /**
   * M4 (deep-review 2026-05-27): consume a `card.updated` pg-boss job.
   * Re-fetches both the previous and current rows from the DB so the
   * job payload stays minimal. Falls back to a no-op if either row has
   * been deleted between publish and consume — a rare race that
   * shouldn't open phantom alerts.
   */
  private async handleQueuedCardUpdate(
    data: CardUpdatedJobData,
  ): Promise<void> {
    if (!this.cardRepo) {
      this.logger.warn(
        `card.updated received but cardRepo unavailable — skipping ${data.cardKey}`,
      );
      return;
    }
    const current = await this.cardRepo.findOne({
      where: { id: data.currentId },
    });
    if (!current) {
      this.logger.warn(
        `card.updated current row missing (id=${data.currentId}, cardKey=${data.cardKey}) — skipping`,
      );
      return;
    }
    const previous = data.previousId
      ? ((await this.cardRepo.findOne({
          where: { id: data.previousId },
        })) ?? null)
      : null;
    await this.onCardChanged({ cardKey: data.cardKey, previous, current });
  }

  /**
   * Handle a `KnowledgeCardService` upsert event. Opens one alert per
   * rule that cites the changed cardKey. No alert when:
   *   - it's a first-ingest (previous is null) — there's nothing to
   *     review against. Operators should treat first-ingest as the
   *     baseline they reviewed when they introduced the rule.
   *   - no rule cites the cardKey (the card stands alone).
   */
  async onCardChanged(event: {
    cardKey: string;
    previous: KnowledgeCardEntity | null;
    current: KnowledgeCardEntity;
  }): Promise<void> {
    if (!event.previous) {
      this.logger.debug(
        `card.first-ingest cardKey=${event.cardKey} — no alerts`,
      );
      return;
    }
    if (event.previous.contentHash === event.current.contentHash) return;

    const rules = this.registry.rulesForCard(event.cardKey);
    if (rules.length === 0) {
      this.logger.debug(
        `card.change.unlinked cardKey=${event.cardKey} — no rule cites this card`,
      );
      return;
    }

    const diffSummary = this.summarizeDiff(event.previous, event.current);
    for (const rule of rules) {
      const alert = await this.alerts.openAlert({
        ruleId: rule.id,
        cardKey: event.cardKey,
        previousHash: event.previous.contentHash,
        newHash: event.current.contentHash,
        diffSummary,
      });
      if (this.advisoryEnabled) {
        try {
          const advisoryBlob = await this.advisory.advise(alert);
          if (advisoryBlob) {
            await this.alerts.attachAdvisory(alert.id, advisoryBlob);
          }
        } catch (e: any) {
          this.logger.warn(
            `advisory generation failed for alert ${alert.id}: ${e?.message ?? e}`,
          );
        }
      }
    }
    this.logger.log(
      `card.change cardKey=${event.cardKey} opened ${rules.length} alert(s)`,
    );
  }

  private summarizeDiff(
    previous: KnowledgeCardEntity,
    current: KnowledgeCardEntity,
  ): string {
    const prevText = (previous.payload?.['text'] as string) ?? '';
    const currText = (current.payload?.['text'] as string) ?? '';
    const before = prevText.length;
    const after = currText.length;
    const delta = after - before;
    const sign = delta >= 0 ? '+' : '';
    return `body length ${before} → ${after} (${sign}${delta} chars); hash ${previous.contentHash.slice(0, 12)} → ${current.contentHash.slice(0, 12)}`;
  }

  /**
   * L5 fix (2026-05-27): boot-time scan via a single `IN (...)` query
   * over the union of all cited cardKeys. Logs which rules cite cards
   * that don't yet have an active row, so operators can plan ingestion
   * priorities. Non-blocking (called via `void`) and tolerant of DB
   * outage at boot.
   */
  private async bootIntegrityCheck(): Promise<void> {
    try {
      const rules = this.registry.all();
      const allKeys = new Set<string>();
      for (const rule of rules) {
        for (const key of rule.knowledgeCardKeys) allKeys.add(key);
      }
      if (allKeys.size === 0) {
        this.logger.log('boot integrity: no rules cite knowledge cards');
        return;
      }

      let activeKeys = new Set<string>();
      if (this.cardRepo) {
        const rows = await this.cardRepo.find({
          where: {
            cardKey: In(Array.from(allKeys)),
            status: 'active',
          },
          select: { cardKey: true },
        });
        activeKeys = new Set(rows.map((r) => r.cardKey));
      }

      const missing: Array<{ ruleId: string; cardKey: string }> = [];
      for (const rule of rules) {
        for (const key of rule.knowledgeCardKeys) {
          if (!activeKeys.has(key)) missing.push({ ruleId: rule.id, cardKey: key });
        }
      }

      if (missing.length === 0) {
        this.logger.log('boot integrity: every cited cardKey has an active card');
        return;
      }
      this.logger.warn(
        `boot integrity: ${missing.length} cited card key(s) not yet ingested ` +
          `(rules continue to work; ingestion is a follow-up)`,
      );
      const uniqueKeys = Array.from(new Set(missing.map((m) => m.cardKey)));
      this.logger.debug(
        `missing card keys: ${uniqueKeys.slice(0, 20).join(', ')}${uniqueKeys.length > 20 ? '...' : ''}`,
      );
    } catch (e: any) {
      this.logger.warn(
        `bootIntegrityCheck failed (non-blocking): ${e?.message ?? e}`,
      );
    }
  }
}
