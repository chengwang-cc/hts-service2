import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  CreditLedgerEntity,
  CreditLedgerKind,
  TaxTreatment,
} from '../entities/credit-ledger.entity';
import { CreditBalanceEntity } from '../entities/credit-balance.entity';
import type { ActorContext } from '../types/actor-context';

/**
 * Append-only ledger writer + reader.
 *
 * Phase 1, PR F1.1 of the financial management rollout.
 * Design doc: docs/2026-06-17/0736_financial-management-system-design.md §5
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §2.1
 *
 * Authority + cutover
 * -------------------
 * Today (this PR) the ledger runs in SHADOW mode behind the
 * `LEDGER_SHADOW_WRITE` env flag (default `true`). Existing services
 * (CreditPurchaseService, BillingChargeService, AutoTopupService)
 * call `shadowAppend()` immediately after their legacy
 * `credit_balances` updates. Failures in the shadow path are SWALLOWED
 * (debug log only) — the legacy path remains authoritative.
 *
 * After ~1 week of clean shadow writes (validated via the
 * pre-cutover drift query in §2.2 of the execution doc), PR F1.2 flips
 * `LEDGER_AUTHORITY=ledger` and the legacy direct-update paths get
 * replaced with `append()` calls in a single transaction.
 *
 * Contract
 * --------
 *   - `append(entry, actor)`: writes one row, materializes
 *     `credit_balances.balance` in the same transaction, returns the
 *     new row. Throws on any DB error.
 *   - `shadowAppend(entry, actor)`: same write, but errors are caught
 *     and logged at debug; returns void. Only used while
 *     `LEDGER_SHADOW_WRITE=true`.
 *
 * Idempotency
 * -----------
 * If `entry.idempotencyKey` is set and a row with that key already
 * exists, `append()` returns the existing row without re-applying the
 * delta. Mirrors the Stripe-shape contract from the existing
 * IdempotencyService.
 *
 * Concurrency
 * -----------
 * Two concurrent appends against the same org serialize through a
 * `SELECT ... FOR UPDATE` on `credit_balances`. The materialized
 * `balance_after` snapshot is captured under that lock.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(CreditLedgerEntity)
    private readonly ledger: Repository<CreditLedgerEntity>,
    @InjectRepository(CreditBalanceEntity)
    private readonly balances: Repository<CreditBalanceEntity>,
  ) {}

  /**
   * Append a ledger row + materialize the balance atomically.
   *
   * Returns the ledger row with `balance_after` populated. On
   * idempotency replay (matching `idempotencyKey`) returns the
   * existing row WITHOUT re-applying the delta.
   */
  async append(
    entry: AppendLedgerInput,
    actor: ActorContext,
  ): Promise<CreditLedgerEntity> {
    if (entry.idempotencyKey) {
      const existing = await this.ledger.findOne({
        where: { idempotencyKey: entry.idempotencyKey },
      });
      if (existing) {
        this.logger.debug(
          `[ledger] idempotent replay org=${entry.organizationId} key=${entry.idempotencyKey} → ${existing.id}`,
        );
        return existing;
      }
    }

    return this.ds.transaction(async (tx) => {
      // Serialize concurrent writers via row-level lock on the balance row.
      const rows = await tx.query<Array<{ balance: number }>>(
        'SELECT balance FROM credit_balances WHERE organization_id = $1 FOR UPDATE',
        [entry.organizationId],
      );
      const before = rows[0]?.balance ?? 0;
      const after = before + entry.deltaCredits;

      const created = tx.getRepository(CreditLedgerEntity).create({
        organizationId: entry.organizationId,
        deltaCredits: entry.deltaCredits,
        balanceAfter: after,
        kind: entry.kind,
        reasonCode: entry.reasonCode ?? null,
        internalNote: entry.internalNote ?? null,
        referenceType: entry.referenceType ?? null,
        referenceId: entry.referenceId ?? null,
        stripeBalanceTransactionId: entry.stripeBalanceTransactionId ?? null,
        stripeChargeId: entry.stripeChargeId ?? null,
        currency: entry.currency ?? 'USD',
        amountMinorUnits:
          entry.amountMinorUnits != null ? String(entry.amountMinorUnits) : null,
        fxRateToFunctional: '1.0',
        fxRateSource: entry.fxRateSource ?? null,
        fxRateCapturedAt: entry.fxRateCapturedAt ?? null,
        amountFunctionalMinorUnits:
          entry.amountMinorUnits != null ? String(entry.amountMinorUnits) : null,
        taxTreatment: entry.taxTreatment ?? 'NON_TAXABLE_PROMO',
        actorKind: actor.kind,
        actorUserId: actor.userId ?? null,
        actorIp: actor.ip ?? null,
        actorUserAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
        idempotencyKey: entry.idempotencyKey ?? null,
        metadata: entry.metadata ?? {},
      });
      const saved = await tx.getRepository(CreditLedgerEntity).save(created);

      // Materialize the balance. The row already exists for any org
      // that has ever transacted; an INSERT ... ON CONFLICT keeps the
      // edge case (first-ever transaction) clean. Lifetime sums are
      // left to legacy writers for now — Phase 1 only stewards
      // `balance`.
      await tx.query(
        `INSERT INTO credit_balances
           (id, organization_id, balance, lifetime_purchased, lifetime_used, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 0, 0, now(), now())
         ON CONFLICT (organization_id) DO UPDATE
           SET balance = $2, updated_at = now()`,
        [entry.organizationId, after],
      );

      return saved;
    });
  }

  /**
   * Best-effort write. Errors are logged and swallowed. Used during
   * Phase 1 SHADOW MODE so a ledger bug never breaks the existing
   * charge or refill paths.
   *
   * Once LEDGER_AUTHORITY=ledger (PR F1.2) the legacy paths get
   * replaced with `append()` directly and `shadowAppend` becomes
   * dead code (kept for one more PR cycle before removal).
   */
  async shadowAppend(
    entry: AppendLedgerInput,
    actor: ActorContext,
  ): Promise<void> {
    try {
      await this.append(entry, actor);
    } catch (err) {
      this.logger.warn(
        `[ledger][shadow] append swallowed org=${entry.organizationId} kind=${entry.kind}: ${(err as Error)?.message}`,
      );
    }
  }

  async getBalance(organizationId: string): Promise<number> {
    const row = await this.balances.findOne({ where: { organizationId } });
    return row?.balance ?? 0;
  }

  async listForOrganization(
    organizationId: string,
    limit = 50,
    offset = 0,
  ): Promise<CreditLedgerEntity[]> {
    return this.ledger.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Sum of all ledger deltas for an org. Used by the reconciliation
   * cron to assert `SUM(delta) == credit_balances.balance`.
   */
  async sumForOrganization(organizationId: string): Promise<number> {
    const result = await this.ds.query<Array<{ sum: string | null }>>(
      'SELECT COALESCE(SUM(delta_credits), 0)::text AS sum FROM credit_ledger WHERE organization_id = $1',
      [organizationId],
    );
    return Number(result[0]?.sum ?? '0');
  }
}

export interface AppendLedgerInput {
  organizationId: string;
  /** Signed: positive grants credits, negative debits. Non-zero. */
  deltaCredits: number;
  kind: CreditLedgerKind;
  reasonCode?: string;
  internalNote?: string;
  referenceType?: string;
  referenceId?: string;
  stripeBalanceTransactionId?: string;
  stripeChargeId?: string;
  currency?: string;
  /** Integer minor units (cents). Optional — only set for monetary movements. */
  amountMinorUnits?: number;
  fxRateSource?: string;
  fxRateCapturedAt?: Date;
  taxTreatment?: TaxTreatment;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}
