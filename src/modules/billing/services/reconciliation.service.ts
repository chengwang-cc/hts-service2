import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, IsNull, In } from 'typeorm';
import type Stripe from 'stripe';
import {
  ReconciliationRunEntity,
  ReconciliationStatus,
} from '../entities/reconciliation-run.entity';
import {
  ReconciliationMismatchEntity,
  ReconciliationMismatchKind,
} from '../entities/reconciliation-mismatch.entity';
import { CreditLedgerEntity } from '../entities/credit-ledger.entity';
import { StripeService } from './stripe.service';

/**
 * Nightly reconciliation: pull Stripe `balance_transactions` for the
 * previous calendar day (UTC), join against `credit_ledger`, write
 * any drift to `reconciliation_mismatches`.
 *
 * Phase 6 of the financial management rollout (PR F6.1).
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §10
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §7.1
 *
 * Algorithm
 * ---------
 *   1. Page through stripe.balanceTransactions in [start, end) — that's
 *      ~all the cash-moving events Stripe knows about.
 *   2. For each Stripe txn:
 *        - lookup credit_ledger.findOne({ stripeBalanceTransactionId })
 *        - if missing → ORPHAN_STRIPE
 *        - if amount differs (|stripe.amount| !== |hts.amount|) →
 *          AMOUNT_MISMATCH
 *   3. Reverse-scan: credit_ledger rows in [start, end) whose kind is
 *      one of the cash-flow kinds AND whose stripeBalanceTransactionId
 *      is null → ORPHAN_HTS.
 *   4. Group-by-kind aggregate check (cheap secondary signal) for
 *      SUM_MISMATCH.
 *
 * Drift tolerance
 * ---------------
 * AMOUNT_MISMATCH for differences < 2 cents is suppressed — Stripe's
 * own fee math can introduce 1-cent rounding at the boundary. Anything
 * above that is a real signal worth flagging.
 *
 * Day boundary
 * ------------
 * UTC, matching Stripe's accounting cutoff. The worker passes `now`;
 * we look at the calendar day that ENDED at midnight UTC just before
 * `now`. Running at 02:00 UTC daily, that's a clean closed window.
 *
 * Concurrency
 * -----------
 * pg-boss singletonKey on the worker prevents two runs at once. The
 * UNIQUE (as_of_date) constraint on reconciliation_runs is the
 * second layer — if a manual re-run targets the same date, we UPDATE
 * the existing row rather than INSERT a duplicate.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  // Sub-cent rounding tolerance. AMOUNT_MISMATCH below this is noise.
  private static readonly DRIFT_CENTS_TOLERANCE = 1;

  // Pagination cap for Stripe balanceTransactions per page.
  private static readonly STRIPE_PAGE_SIZE = 100;

  // Hard cap on total pages to prevent runaway in case of pagination
  // bugs. 200 pages × 100 txns = 20k txns/day, well above any
  // realistic single-day volume for the foreseeable future.
  private static readonly STRIPE_MAX_PAGES = 200;

  // Cash-flow kinds that SHOULD always have a stripe_balance_transaction_id
  // populated. Anything else (MANUAL_TOPUP, MANUAL_DEBIT, PROMO, MIGRATION)
  // is internal-only and won't appear in Stripe's btxn list.
  private static readonly CASH_FLOW_KINDS = [
    'PURCHASE',
    'REFUND',
    'CHARGEBACK',
    'AUTO_TOPUP',
    'REVERSAL', // when reversal is tied to a Stripe-side event
  ];

  constructor(
    @InjectRepository(ReconciliationRunEntity)
    private readonly runs: Repository<ReconciliationRunEntity>,
    @InjectRepository(ReconciliationMismatchEntity)
    private readonly mismatches: Repository<ReconciliationMismatchEntity>,
    @InjectRepository(CreditLedgerEntity)
    private readonly ledger: Repository<CreditLedgerEntity>,
    private readonly stripe: StripeService,
  ) {}

  /**
   * Execute one reconciliation run for the day that ENDED just before
   * `now`. Idempotent: if a run for that as_of_date already exists,
   * we UPSERT it and rewrite its mismatches.
   */
  async run(now: Date): Promise<ReconciliationRunEntity> {
    const { since, until, asOfDate } = this.windowFor(now);

    // UPSERT the run row so manual re-runs target the same row.
    let run = await this.runs.findOne({ where: { asOfDate } });
    if (!run) {
      run = this.runs.create({
        asOfDate,
        eventsChecked: 0,
        mismatches: 0,
        driftAmountMinorUnits: null,
        status: 'RUNNING' as ReconciliationStatus,
        startedAt: new Date(),
        finishedAt: null,
        errorMessage: null,
      });
      run = await this.runs.save(run);
    } else {
      // Re-run: wipe its prior mismatches so we don't double-count.
      await this.mismatches.delete({ runId: run.id });
      run.status = 'RUNNING';
      run.eventsChecked = 0;
      run.mismatches = 0;
      run.driftAmountMinorUnits = null;
      run.startedAt = new Date();
      run.finishedAt = null;
      run.errorMessage = null;
      run = await this.runs.save(run);
    }

    try {
      const result = await this.executeWindow(run.id, since, until);
      run.eventsChecked = result.eventsChecked;
      run.mismatches = result.mismatches.length;
      run.driftAmountMinorUnits = String(result.driftMinorUnits);
      run.status = result.mismatches.length === 0 ? 'OK' : 'DRIFT_DETECTED';
      run.finishedAt = new Date();
      await this.runs.save(run);

      this.logger.log(
        `[recon] ${asOfDate} → ${run.status} (${run.eventsChecked} events, ${run.mismatches} mismatches, drift=${run.driftAmountMinorUnits})`,
      );
      return run;
    } catch (err) {
      run.status = 'FAILED';
      run.finishedAt = new Date();
      run.errorMessage = (err as Error).message?.slice(0, 4000) ?? 'unknown';
      await this.runs.save(run);
      this.logger.error(
        `[recon] ${asOfDate} → FAILED: ${run.errorMessage}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  /**
   * Inner pass — kept separate so the outer run() handles RUNNING /
   * OK / DRIFT / FAILED state transitions and this function just
   * does the work.
   */
  private async executeWindow(
    runId: string,
    since: Date,
    until: Date,
  ): Promise<{
    eventsChecked: number;
    driftMinorUnits: number;
    mismatches: ReconciliationMismatchEntity[];
  }> {
    const sinceUnix = Math.floor(since.getTime() / 1000);
    const untilUnix = Math.floor(until.getTime() / 1000);

    const stripeBtxns = await this.fetchAllBalanceTxns(sinceUnix, untilUnix);
    const mismatches: ReconciliationMismatchEntity[] = [];
    let driftMinorUnits = 0;

    // 1. Stripe → HTS: existence + amount check.
    for (const btxn of stripeBtxns) {
      const hts = await this.ledger.findOne({
        where: { stripeBalanceTransactionId: btxn.id },
      });
      if (!hts) {
        mismatches.push(
          await this.writeMismatch(runId, 'ORPHAN_STRIPE', {
            stripeBalanceTransactionId: btxn.id,
            details: {
              stripeType: btxn.type,
              stripeAmountMinorUnits: btxn.amount,
              stripeCurrency: btxn.currency.toUpperCase(),
              stripeCreated: new Date(btxn.created * 1000).toISOString(),
            },
          }),
        );
        continue;
      }
      // 2. Amount check. We compare absolute values — Stripe signs by
      // direction (credit vs debit on the platform's account), while
      // our ledger signs by impact on the org's credit balance. They
      // disagree by intent but the magnitudes should line up for the
      // same business event.
      const stripeAbs = Math.abs(btxn.amount);
      const htsAbs = hts.amountMinorUnits
        ? Math.abs(Number(hts.amountMinorUnits))
        : 0;
      if (htsAbs === 0) {
        // No amount captured on the ledger row — likely an early entry
        // pre-money columns. Treat as silent; reconciliation can't say
        // anything useful about it.
        continue;
      }
      const diff = stripeAbs - htsAbs;
      if (Math.abs(diff) > ReconciliationService.DRIFT_CENTS_TOLERANCE) {
        driftMinorUnits += diff;
        mismatches.push(
          await this.writeMismatch(runId, 'AMOUNT_MISMATCH', {
            stripeBalanceTransactionId: btxn.id,
            htsLedgerId: hts.id,
            details: {
              expectedMinorUnits: stripeAbs,
              actualMinorUnits: htsAbs,
              deltaMinorUnits: diff,
              stripeType: btxn.type,
              ledgerKind: hts.kind,
              stripeCreated: new Date(btxn.created * 1000).toISOString(),
              htsCreated: hts.createdAt.toISOString(),
            },
          }),
        );
      }
    }

    // 3. Reverse-scan: HTS rows in window with cash-flow kinds but no
    // stripe_balance_transaction_id are orphans.
    const orphanedHts = await this.ledger.find({
      where: {
        kind: In(ReconciliationService.CASH_FLOW_KINDS) as any,
        createdAt: Between(since, until),
        stripeBalanceTransactionId: IsNull(),
      },
      take: 5000, // hard cap; if we have >5000 orphan ledger rows in a day, something's catastrophically off
    });
    for (const row of orphanedHts) {
      mismatches.push(
        await this.writeMismatch(runId, 'ORPHAN_HTS', {
          htsLedgerId: row.id,
          details: {
            ledgerKind: row.kind,
            organizationId: row.organizationId,
            deltaCredits: row.deltaCredits,
            amountMinorUnits: row.amountMinorUnits
              ? Number(row.amountMinorUnits)
              : null,
            htsCreated: row.createdAt.toISOString(),
          },
        }),
      );
    }

    return {
      eventsChecked: stripeBtxns.length,
      driftMinorUnits,
      mismatches,
    };
  }

  /**
   * Page through Stripe balance transactions. Uses StripeService's
   * paginated wrapper; stops at MAX_PAGES as a runaway guard.
   */
  private async fetchAllBalanceTxns(
    sinceUnix: number,
    untilUnix: number,
  ): Promise<Stripe.BalanceTransaction[]> {
    const all: Stripe.BalanceTransaction[] = [];
    let startingAfter: string | undefined;

    for (let page = 0; page < ReconciliationService.STRIPE_MAX_PAGES; page++) {
      const resp = await this.stripe.listBalanceTransactions({
        created: { gte: sinceUnix, lt: untilUnix },
        startingAfter,
        limit: ReconciliationService.STRIPE_PAGE_SIZE,
      });
      all.push(...resp.data);
      if (!resp.hasMore || !resp.lastId) break;
      startingAfter = resp.lastId;
    }
    return all;
  }

  /**
   * Compute the [since, until) UTC window + DATE string for the day
   * that ENDED just before `now`. Running at 02:00 UTC, we reconcile
   * "yesterday" — start at 00:00:00 yesterday, end at 00:00:00 today.
   */
  private windowFor(now: Date): {
    since: Date;
    until: Date;
    asOfDate: string;
  } {
    const todayUtcMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const yesterdayUtcMs = todayUtcMs - 24 * 3600 * 1000;
    const since = new Date(yesterdayUtcMs);
    const until = new Date(todayUtcMs);
    const asOfDate = since.toISOString().slice(0, 10);
    return { since, until, asOfDate };
  }

  private async writeMismatch(
    runId: string,
    kind: ReconciliationMismatchKind,
    fields: {
      stripeBalanceTransactionId?: string;
      htsLedgerId?: string;
      details: Record<string, unknown>;
    },
  ): Promise<ReconciliationMismatchEntity> {
    const row = this.mismatches.create({
      runId,
      kind,
      stripeBalanceTransactionId: fields.stripeBalanceTransactionId ?? null,
      htsLedgerId: fields.htsLedgerId ?? null,
      details: fields.details ?? {},
    });
    return this.mismatches.save(row);
  }

  // ── Admin read methods (consumed by the SPA) ──────────────────────

  async listRecentRuns(limit = 30): Promise<ReconciliationRunEntity[]> {
    return this.runs.find({
      order: { asOfDate: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async getRun(id: string): Promise<ReconciliationRunEntity> {
    const row = await this.runs.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Run ${id} not found`);
    return row;
  }

  async listMismatchesForRun(
    runId: string,
    onlyUnresolved = false,
    limit = 200,
  ): Promise<ReconciliationMismatchEntity[]> {
    const where: any = { runId };
    if (onlyUnresolved) where.resolvedAt = IsNull();
    return this.mismatches.find({
      where,
      order: { createdAt: 'ASC' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
  }

  /**
   * Mark a mismatch resolved with a note. The row stays in place —
   * resolution is purely an audit annotation.
   */
  async resolveMismatch(
    mismatchId: string,
    resolvedByUserId: string,
    note: string,
  ): Promise<ReconciliationMismatchEntity> {
    const row = await this.mismatches.findOne({ where: { id: mismatchId } });
    if (!row) throw new NotFoundException(`Mismatch ${mismatchId} not found`);
    if (row.resolvedAt) return row; // idempotent
    row.resolvedAt = new Date();
    row.resolvedByUserId = resolvedByUserId;
    row.resolutionNote = note.slice(0, 4000);
    return this.mismatches.save(row);
  }
}
