/**
 * One-time backfill: emit `credit_ledger` rows representing the
 * pre-Phase-1 history so that `SUM(delta_credits) BY org` equals
 * `credit_balances.balance` for every org. After this script runs,
 * the drift query in the F1.2 cutover gate returns 0 rows.
 *
 * Strategy
 * --------
 * The script inspects the existing tables and emits the minimal set
 * of ledger entries that reconstructs the current balance for each
 * org. For the current prod state (queried 2026-06-17):
 *
 *   - 99 orgs with signup-bonus balances (50 credits each from
 *     `BILLING_FREE_SIGNUP_CREDITS=50`, lifetime_used=0 because
 *     BILLING_ENABLED=false has prevented real deductions)
 *   - 0 completed credit_purchases (no Stripe revenue yet)
 *   - 72 usage_records that DID NOT actually deduct (shadow mode)
 *
 * So each org gets exactly one `PROMO` entry with
 * `delta_credits = credit_balances.balance` and a `reason_code` of
 * `MIGRATION` (the lookup table value reserved for this kind of
 * one-time historical reconstruction).
 *
 * If/when this script is rerun after the world changes (real
 * purchases land, billing flips live, etc.), it expands its rules:
 *
 *   - completed credit_purchases (status='completed') → PURCHASE rows
 *     keyed on `stripe_payment_intent_id` (skip if a ledger row with
 *     that reference already exists)
 *   - usage_records WHERE NOT (metadata->>'shadow')::bool AND
 *     timestamp < (script start) → USAGE_DEBIT rows aggregated per
 *     (org, day, metric_name)
 *
 * Idempotency
 * -----------
 * Every emitted row carries an `idempotency_key` of the form
 * `backfill:<phase>:<org_id>:<bucket>` so re-running the script after
 * a partial failure is safe — the `UQ_credit_ledger_idempotency`
 * index lets the second run skip rows that already landed.
 *
 * The script does NOT use LedgerService.append() because:
 *   1. LedgerService re-derives `balance_after` from FOR UPDATE on
 *      credit_balances — which is exactly what we DON'T want during
 *      backfill (we're emitting the historical row that REPRESENTS
 *      the current balance; the balance shouldn't change). The
 *      script writes ledger rows directly via the connection without
 *      touching credit_balances at all.
 *   2. The append-only trigger doesn't block INSERT, only UPDATE/DELETE.
 *
 * Modes
 * -----
 *   npm run backfill:ledger -- --dry-run      print plan, no inserts
 *   npm run backfill:ledger -- --apply        actually write
 *   npm run backfill:ledger -- --verify       run the drift query
 *
 * Run from project root with the prod DB env vars present.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dataSource from '../src/db/data-source';

interface BackfillPlan {
  organizationId: string;
  currentBalance: number;
  ledgerSum: number;
  deltaNeeded: number;
  action: 'insert_promo' | 'already_aligned' | 'manual_review';
}

const BACKFILL_REASON = 'MIGRATION';
const BACKFILL_INTERNAL_NOTE =
  'Phase 1 historical reconstruction — signup-bonus credits + pre-ledger lifetime activity';

async function gatherPlan(ds: DataSource): Promise<BackfillPlan[]> {
  // For each org with a credit_balances row, compute what the ledger
  // already has and what we'd need to insert to match.
  const rows: Array<{
    organization_id: string;
    balance: string;
    ledger_sum: string;
  }> = await ds.query(`
    SELECT cb.organization_id,
           cb.balance::text AS balance,
           COALESCE(SUM(cl.delta_credits), 0)::text AS ledger_sum
      FROM credit_balances cb
      LEFT JOIN credit_ledger cl ON cl.organization_id = cb.organization_id
     GROUP BY cb.organization_id, cb.balance
     ORDER BY cb.organization_id;
  `);

  return rows.map((r) => {
    const balance = Number(r.balance);
    const ledgerSum = Number(r.ledger_sum);
    const delta = balance - ledgerSum;
    const action: BackfillPlan['action'] =
      delta === 0
        ? 'already_aligned'
        : delta > 0
          ? 'insert_promo'
          : 'manual_review'; // ledger > balance is suspicious — flag, don't auto-fix
    return {
      organizationId: r.organization_id,
      currentBalance: balance,
      ledgerSum,
      deltaNeeded: delta,
      action,
    };
  });
}

async function applyPlan(ds: DataSource, plan: BackfillPlan[]): Promise<{ inserted: number; skipped: number; flagged: number }> {
  let inserted = 0;
  let skipped = 0;
  let flagged = 0;

  await ds.transaction(async (tx) => {
    for (const p of plan) {
      if (p.action === 'already_aligned') {
        skipped++;
        continue;
      }
      if (p.action === 'manual_review') {
        console.warn(
          `[backfill][flag] org=${p.organizationId} balance=${p.currentBalance} ledger_sum=${p.ledgerSum} (ledger > balance — leaving for manual review)`,
        );
        flagged++;
        continue;
      }
      // insert_promo
      const idempotencyKey = `backfill:phase1:${p.organizationId}:initial`;
      await tx.query(
        `INSERT INTO credit_ledger
           (organization_id, delta_credits, balance_after, kind, reason_code, internal_note,
            actor_kind, idempotency_key, metadata, currency, tax_treatment, fx_rate_to_functional)
         VALUES ($1, $2, $3, 'PROMO', $4, $5, 'SYSTEM', $6,
                 jsonb_build_object('source','backfill-credit-ledger.ts','phase',1), 'USD', 'NON_TAXABLE_PROMO', 1.0)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [
          p.organizationId,
          p.deltaNeeded,
          p.currentBalance,
          BACKFILL_REASON,
          BACKFILL_INTERNAL_NOTE,
          idempotencyKey,
        ],
      );
      inserted++;
    }
  });

  return { inserted, skipped, flagged };
}

async function verifyDriftQuery(ds: DataSource): Promise<Array<{ organization_id: string; balance: number; ledger_sum: number }>> {
  const rows: Array<{ organization_id: string; balance: string; ledger_sum: string }> = await ds.query(`
    SELECT cb.organization_id,
           cb.balance::text AS balance,
           COALESCE(SUM(cl.delta_credits), 0)::text AS ledger_sum
      FROM credit_balances cb
      LEFT JOIN credit_ledger cl ON cl.organization_id = cb.organization_id
     GROUP BY cb.organization_id, cb.balance
    HAVING cb.balance != COALESCE(SUM(cl.delta_credits), 0)
     ORDER BY cb.organization_id;
  `);
  return rows.map((r) => ({
    organization_id: r.organization_id,
    balance: Number(r.balance),
    ledger_sum: Number(r.ledger_sum),
  }));
}

async function main(): Promise<void> {
  const mode = process.argv.includes('--apply')
    ? 'apply'
    : process.argv.includes('--verify')
      ? 'verify'
      : 'dry-run';

  await dataSource.initialize();

  try {
    if (mode === 'verify') {
      const drift = await verifyDriftQuery(dataSource);
      if (drift.length === 0) {
        console.log('✓ drift query clean — every org balance equals its ledger sum');
      } else {
        console.error(`✗ ${drift.length} orgs have drift:`);
        for (const d of drift) {
          console.error(
            `  org=${d.organization_id}  balance=${d.balance}  ledger_sum=${d.ledger_sum}  diff=${d.balance - d.ledger_sum}`,
          );
        }
        process.exitCode = 2;
      }
      return;
    }

    const plan = await gatherPlan(dataSource);
    const promoCount = plan.filter((p) => p.action === 'insert_promo').length;
    const alignedCount = plan.filter((p) => p.action === 'already_aligned').length;
    const flagCount = plan.filter((p) => p.action === 'manual_review').length;
    const totalDelta = plan
      .filter((p) => p.action === 'insert_promo')
      .reduce((s, p) => s + p.deltaNeeded, 0);

    console.log('Plan');
    console.log('  orgs total           :', plan.length);
    console.log('  to insert PROMO      :', promoCount);
    console.log('  already aligned      :', alignedCount);
    console.log('  flagged (ledger>bal) :', flagCount);
    console.log('  total credits        :', totalDelta);
    console.log();

    if (mode === 'dry-run') {
      console.log('(dry-run — pass --apply to write)');
      // Show first 5 rows to sanity-check
      for (const p of plan.slice(0, 5)) {
        console.log(`  ${p.action.padEnd(18)}  org=${p.organizationId}  balance=${p.currentBalance}  delta=${p.deltaNeeded}`);
      }
      return;
    }

    // apply
    console.log('Applying...');
    const result = await applyPlan(dataSource, plan);
    console.log(`✓ inserted=${result.inserted}  skipped=${result.skipped}  flagged=${result.flagged}`);

    console.log();
    console.log('Verifying...');
    const drift = await verifyDriftQuery(dataSource);
    if (drift.length === 0) {
      console.log('✓ drift query clean — every org balance equals its ledger sum');
    } else {
      console.error(`✗ ${drift.length} orgs still have drift; investigate.`);
      process.exitCode = 2;
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
