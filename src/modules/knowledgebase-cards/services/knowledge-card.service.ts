import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AuditService } from '../../audit/services/audit.service';
import { TelemetryService } from '../../observability/telemetry.service';
import { KnowledgeCardEntity } from '../entities/knowledge-card.entity';
import { QueueService } from '../../queue/queue.service';

/** Queue name for cross-pod card change events (M4). */
export const KB_CARD_UPDATED_QUEUE = 'card.updated';

/** Payload of the `card.updated` pg-boss job. */
export interface CardUpdatedJobData {
  cardKey: string;
  previousId: string | null;
  currentId: string;
  previousHash: string | null;
  newHash: string;
}

/**
 * KnowledgeCardService (Phase 8, P8.T7).
 *
 * Upserts knowledge cards by `cardKey` with content-hash diff detection:
 *
 *   - first ingest         → insert with status `active`
 *   - same hash as active  → no-op (idempotent)
 *   - different hash       → mark prior `superseded`, insert new with
 *                            status `pending_review`. Emits a
 *                            `card.updated` event so the change-detector
 *                            can open alerts.
 *
 * `payload` stores extracted text + classifier output + chunk lineage.
 * The embedding column is filled by the ingestion service after the
 * row is persisted.
 */
export type CardUpsertOutcome = 'inserted' | 'unchanged' | 'superseded';

export interface CardUpsertResult {
  card: KnowledgeCardEntity;
  outcome: CardUpsertOutcome;
  previousCard?: KnowledgeCardEntity | null;
}

export interface CardUpsertInput {
  cardKey: string;
  documentType: string;
  jurisdiction?: string | null;
  sourceUrl?: string | null;
  storageRef?: string | null;
  /** The extracted text (used to derive contentHash). */
  text: string;
  /** Payload JSON — chunks, classification metadata, etc. */
  payload: Record<string, unknown>;
  effectiveDate?: Date | null;
  expirationDate?: Date | null;
  ingestedBy?: string;
}

@Injectable()
export class KnowledgeCardService {
  private readonly logger = new Logger(KnowledgeCardService.name);
  private readonly listeners: Array<
    (event: { cardKey: string; previous: KnowledgeCardEntity | null; current: KnowledgeCardEntity }) => void | Promise<void>
  > = [];
  /**
   * M4 (deep-review 2026-05-27): when set, card changes are published
   * via pg-boss instead of (or in addition to) the in-process listener
   * array. This lets a worker pod consume `card.updated` events even
   * when ingestion runs on a different replica.
   */
  private readonly viaQueue =
    process.env.KB_CARD_EVENTS_VIA_QUEUE === 'true';

  constructor(
    @InjectRepository(KnowledgeCardEntity)
    private readonly repo: Repository<KnowledgeCardEntity>,
    @Optional() private readonly queue?: QueueService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly telemetry?: TelemetryService,
  ) {}

  /**
   * Compute the canonical content hash for a card payload. Stable
   * across whitespace / casing variations within the body.
   */
  static hashContent(text: string): string {
    const normalized = (text || '').replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /** Subscribe to card-change events (Phase 8.10 alert detector). */
  onCardChanged(
    fn: (event: { cardKey: string; previous: KnowledgeCardEntity | null; current: KnowledgeCardEntity }) => void | Promise<void>,
  ): void {
    this.listeners.push(fn);
  }

  /**
   * Find the currently-active card for a cardKey, if one exists.
   */
  async findActive(cardKey: string): Promise<KnowledgeCardEntity | null> {
    return (await this.repo.findOne({ where: { cardKey, status: 'active' } })) ?? null;
  }

  /** Full history for a cardKey, newest first. */
  async history(cardKey: string): Promise<KnowledgeCardEntity[]> {
    return this.repo.find({ where: { cardKey }, order: { createdAt: 'DESC' } });
  }

  /**
   * Active cards across all cardKeys, most-recently-updated first.
   * H3 fix (2026-05-27): the admin `GET /admin/knowledgebase/cards`
   * was previously calling `history('')` (always empty). This is the
   * correct shape.
   */
  async listActive(limit = 50): Promise<KnowledgeCardEntity[]> {
    return this.repo.find({
      where: { status: 'active' },
      order: { updatedAt: 'DESC' },
      take: Math.max(1, Math.min(500, limit)),
    });
  }

  /**
   * Upsert with diff detection. See class docstring for state diagram.
   */
  async upsert(input: CardUpsertInput): Promise<CardUpsertResult> {
    const contentHash = KnowledgeCardService.hashContent(input.text);
    const existing = await this.findActive(input.cardKey);

    if (existing && existing.contentHash === contentHash) {
      this.logger.debug(
        `card.unchanged cardKey=${input.cardKey} hash=${contentHash.slice(0, 12)}`,
      );
      return { card: existing, outcome: 'unchanged', previousCard: existing };
    }

    // Insert new row first so we have an id to write the embedding against.
    const newRow = this.repo.create({
      cardKey: input.cardKey,
      documentType: input.documentType,
      jurisdiction: input.jurisdiction ?? null,
      sourceUrl: input.sourceUrl ?? null,
      storageRef: input.storageRef ?? null,
      contentHash,
      payload: input.payload,
      status: existing ? 'pending_review' : 'active',
      effectiveDate: input.effectiveDate ?? null,
      expirationDate: input.expirationDate ?? null,
      ingestedBy: input.ingestedBy ?? 'system',
    } as KnowledgeCardEntity);
    const saved = await this.repo.save(newRow);

    if (existing) {
      existing.status = 'superseded';
      await this.repo.save(existing);
    }

    this.logger.log(
      `card.${existing ? 'superseded' : 'inserted'} cardKey=${input.cardKey} hash=${contentHash.slice(0, 12)}`,
    );

    if (this.viaQueue && this.queue) {
      // M4 path: publish a minimal payload; the detector re-fetches both
      // rows. This keeps the queue payload small and avoids serializing
      // a payload field that may contain large extracted text.
      const job: CardUpdatedJobData = {
        cardKey: input.cardKey,
        previousId: existing?.id ?? null,
        currentId: saved.id,
        previousHash: existing?.contentHash ?? null,
        newHash: saved.contentHash,
      };
      try {
        await this.queue.sendJob(KB_CARD_UPDATED_QUEUE, job);
      } catch (e: any) {
        this.logger.warn(
          `card.updated queue send failed (non-blocking): ${e?.message ?? e}`,
        );
      }
    } else {
      // Legacy in-process path (default). Tests and single-pod installs
      // rely on this — no behavior change.
      for (const fn of this.listeners) {
        try {
          await fn({ cardKey: input.cardKey, previous: existing ?? null, current: saved });
        } catch (e: any) {
          this.logger.warn(`card listener failed: ${e?.message ?? e}`);
        }
      }
    }

    return {
      card: saved,
      outcome: existing ? 'superseded' : 'inserted',
      previousCard: existing,
    };
  }

  /**
   * Promote a `pending_review` card to `active`. Operator action after
   * reviewing the diff + the linked alert. The previously-active card
   * (status `superseded`) stays in history.
   */
  async promoteToActive(cardId: string, actor: string): Promise<KnowledgeCardEntity> {
    const card = await this.repo.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException(`card not found: ${cardId}`);
    if (card.status !== 'pending_review') {
      throw new BadRequestException(
        `card status is ${card.status}, cannot promote`,
      );
    }
    // Ensure any other active row for the same cardKey is superseded.
    const others = await this.repo.find({
      where: { cardKey: card.cardKey, status: 'active' },
    });
    for (const o of others) {
      if (o.id !== card.id) {
        o.status = 'superseded';
        await this.repo.save(o);
      }
    }
    card.status = 'active';
    card.ingestedBy = `${card.ingestedBy}|promoted-by:${actor}`;
    const saved = await this.repo.save(card);
    if (this.audit) {
      await this.audit.record({
        eventType: 'knowledge_card.promoted',
        actorUserId: actor,
        resourceType: 'knowledge_card',
        resourceId: saved.id,
        source: 'knowledge-cards',
        metadata: {
          cardKey: saved.cardKey,
          contentHash: saved.contentHash,
        },
      });
    }
    this.telemetry?.countEvent('knowledge_card_promotions_total');
    return saved;
  }

  /**
   * Produce a diff between the active and most-recent pending_review
   * card for one cardKey. Used by the review UI so an operator can see
   * what changed before promoting the pending card.
   */
  async diffPending(cardKey: string): Promise<{
    cardKey: string;
    active: KnowledgeCardEntity | null;
    pending: KnowledgeCardEntity | null;
    diff: {
      contentHashChanged: boolean;
      documentTypeChanged: boolean;
      jurisdictionChanged: boolean;
      effectiveDateChanged: boolean;
      textDiff: Array<{ op: 'unchanged' | 'added' | 'removed'; text: string }>;
    };
  }> {
    const active = await this.findActive(cardKey);
    const pending =
      (await this.repo.findOne({
        where: { cardKey, status: 'pending_review' },
        order: { createdAt: 'DESC' },
      })) ?? null;
    const activeText = (active?.payload as any)?.text ?? '';
    const pendingText = (pending?.payload as any)?.text ?? '';
    return {
      cardKey,
      active: active ?? null,
      pending,
      diff: {
        contentHashChanged: !!(
          active &&
          pending &&
          active.contentHash !== pending.contentHash
        ),
        documentTypeChanged: !!(
          active &&
          pending &&
          active.documentType !== pending.documentType
        ),
        jurisdictionChanged: !!(
          active &&
          pending &&
          (active.jurisdiction ?? null) !== (pending.jurisdiction ?? null)
        ),
        effectiveDateChanged: !!(
          active &&
          pending &&
          (active.effectiveDate?.getTime() ?? null) !==
            (pending.effectiveDate?.getTime() ?? null)
        ),
        textDiff: lineDiff(activeText, pendingText),
      },
    };
  }

  /** Attach an embedding vector after async generation. */
  async writeEmbedding(
    cardId: string,
    embedding: number[],
    column: 'embedding' | 'embedding_openai',
  ): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (column === 'embedding') updates.embedding = embedding;
    else updates.embeddingOpenai = embedding;
    await this.repo.update({ id: cardId }, updates as any);
  }
}

/**
 * Small Myers-ish line diff. Good enough for the review UI; for very
 * large cards the operator can fall back to clicking through to the
 * source URLs. We keep this in-process so review pages stay snappy
 * and don't need a Python diff service.
 */
function lineDiff(
  oldText: string,
  newText: string,
): Array<{ op: 'unchanged' | 'added' | 'removed'; text: string }> {
  const a = oldText.split(/\r?\n/);
  const b = newText.split(/\r?\n/);
  const m = a.length;
  const n = b.length;
  // Cap to keep memory bounded on huge documents.
  const cap = 4000;
  if (m > cap || n > cap) {
    return [
      { op: 'removed', text: `[diff skipped — ${m} vs ${n} lines exceeds ${cap}]` },
      { op: 'added', text: '[diff skipped — see source URLs]' },
    ];
  }
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: Array<{ op: 'unchanged' | 'added' | 'removed'; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ op: 'unchanged', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ op: 'removed', text: a[i] });
      i += 1;
    } else {
      ops.push({ op: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < m) {
    ops.push({ op: 'removed', text: a[i] });
    i += 1;
  }
  while (j < n) {
    ops.push({ op: 'added', text: b[j] });
    j += 1;
  }
  return ops;
}
