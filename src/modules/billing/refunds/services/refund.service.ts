import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type Stripe from 'stripe';
import { RefundEntity, RefundReason, RefundStatus } from '../../entities/refund.entity';
import { CreditPurchaseEntity } from '../../entities/credit-purchase.entity';
import { StripeService } from '../../services/stripe.service';
import { LedgerService } from '../../services/ledger.service';
import { CreditPurchaseService } from '../../services/credit-purchase.service';
import type { ActorContext } from '../../types/actor-context';

/**
 * Issuance + webhook-driven state machine for Stripe refunds.
 *
 * Phase 4 of the financial management rollout (PR F4.1).
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §8
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §5.1
 *
 * Two flows:
 *
 *  1. createRefund(input, actor)
 *     - Admin or operator hits POST /admin/financial/.../refunds.
 *     - We INSERT a refunds row with status='pending'.
 *     - We call stripe.refunds.create with our idempotency key
 *       forwarded to Stripe (so a retry doesn't fork the refund).
 *     - On Stripe success: UPDATE the row with stripe_refund_id +
 *       stripe_balance_transaction_id. Status stays 'pending' until
 *       the webhook flips it.
 *     - On Stripe immediate failure: status='failed', surface the
 *       failure_reason.
 *
 *  2. onRefundWebhook(event)
 *     - Routed from billing.controller's webhook switch.
 *     - refund.created   → no-op (we already wrote the row above)
 *     - refund.updated   → state transition + ledger debit if newly
 *       succeeded
 *     - refund.failed    → reversal if we had posted a REFUND row
 *
 * Ledger entries
 * --------------
 * On successful refund of a credit purchase, we POST a `REFUND` row
 * to credit_ledger with delta = -credits_returned. Allowed to drive
 * balance negative (Phase 7's negative-balance flow takes over there).
 *
 * If a previously-successful refund flips to failed (Stripe race), we
 * forward-post a `REVERSAL` row that undoes the prior REFUND. We
 * NEVER mutate the original row — append-only is the design contract.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @InjectRepository(RefundEntity)
    private readonly refunds: Repository<RefundEntity>,
    @InjectRepository(CreditPurchaseEntity)
    private readonly purchases: Repository<CreditPurchaseEntity>,
    private readonly stripe: StripeService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Create a Stripe refund and the matching pending row. The
   * `idempotencyKey` is REQUIRED — the controller takes it from the
   * Idempotency-Key header (the SPA mints a UUID v4 on form mount).
   */
  async createRefund(input: CreateRefundInput, actor: ActorContext): Promise<RefundResult> {
    if (!input.idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required for refunds');
    }
    if (input.amountMinorUnits !== undefined && input.amountMinorUnits <= 0) {
      throw new BadRequestException('amountMinorUnits must be positive');
    }

    // Idempotency replay on our side: same key returns the existing row.
    const existing = await this.refunds.findOne({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      this.logger.debug(
        `[refund] idempotent replay key=${input.idempotencyKey} → ${existing.id}`,
      );
      return this.toResult(existing);
    }

    // Look up the original purchase to determine credits_returned
    // (zero if the payment intent wasn't a credit purchase — e.g., a
    // subscription invoice charge being refunded).
    const purchase = await this.purchases.findOne({
      where: { stripePaymentIntentId: input.paymentIntentId },
    });
    if (purchase && purchase.organizationId !== input.organizationId) {
      throw new BadRequestException(
        `Payment intent ${input.paymentIntentId} belongs to a different organization`,
      );
    }

    // Default to full-purchase refund if no amount specified.
    const purchaseAmountMinor = purchase
      ? Math.round(Number(purchase.amount) * 100)
      : 0;
    const amountMinorUnits =
      input.amountMinorUnits ??
      (purchase ? purchaseAmountMinor : undefined);
    if (amountMinorUnits === undefined) {
      throw new BadRequestException(
        'amountMinorUnits is required when refunding an intent that is not a tracked credit purchase',
      );
    }

    // For credit purchases, proportionally compute credits to return.
    // (Full refund returns all credits; partial returns the fraction.)
    const creditsReturned = purchase
      ? Math.round((amountMinorUnits / purchaseAmountMinor) * purchase.credits)
      : 0;

    // INSERT the pending row FIRST. If Stripe call fails, the row
    // stays in 'pending' state and ops can reconcile manually.
    const row = await this.refunds.save(
      this.refunds.create({
        organizationId: input.organizationId,
        originalPaymentIntentId: input.paymentIntentId,
        originalChargeId: null,
        stripeRefundId: null,
        stripeBalanceTransactionId: null,
        amountMinorUnits: String(amountMinorUnits),
        currency: input.currency ?? purchase?.currency ?? 'USD',
        reason: input.reason,
        internalNote: input.internalNote ?? null,
        status: 'pending',
        creditsReturned,
        actorUserId: actor.userId!,
        actorIp: actor.ip ?? null,
        actorUserAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
        idempotencyKey: input.idempotencyKey,
        metadata: { source: 'admin' },
      }),
    );

    let stripeRefund: Stripe.Refund;
    try {
      stripeRefund = await this.stripe.createRefund({
        paymentIntentId: input.paymentIntentId,
        amountMinorUnits,
        reason: input.reason,
        metadata: {
          internalRefundId: row.id,
          organizationId: input.organizationId,
          actorUserId: actor.userId ?? '',
        },
        idempotencyKey: input.idempotencyKey,
      });
    } catch (err) {
      // Mark as failed but keep the row for audit.
      row.status = 'failed';
      row.failureReason = (err as Error)?.message ?? 'unknown stripe error';
      await this.refunds.save(row);
      this.logger.error(
        `[refund] Stripe call failed for ${row.id}: ${row.failureReason}`,
      );
      throw err;
    }

    row.stripeRefundId = stripeRefund.id;
    row.stripeBalanceTransactionId =
      typeof stripeRefund.balance_transaction === 'object' && stripeRefund.balance_transaction
        ? stripeRefund.balance_transaction.id
        : (stripeRefund.balance_transaction as string | null) ?? null;
    row.originalChargeId = typeof stripeRefund.charge === 'string'
      ? stripeRefund.charge
      : stripeRefund.charge?.id ?? null;
    // Stripe may flip status synchronously for some payment methods.
    row.status = this.mapStripeStatus(stripeRefund.status);
    await this.refunds.save(row);

    // If Stripe synchronously confirmed (rare but possible for some
    // payment methods), post the ledger debit now rather than waiting
    // for the webhook.
    if (row.status === 'succeeded') {
      await this.postRefundLedgerEntry(row);
    }

    return this.toResult(row);
  }

  /**
   * Webhook entry point. Routed from billing.controller's switch.
   * Idempotent: matches by stripe_refund_id (UNIQUE).
   */
  async onRefundEvent(event: Stripe.Event): Promise<void> {
    const refund = event.data.object as Stripe.Refund;
    const row = await this.refunds.findOne({
      where: { stripeRefundId: refund.id },
    });
    if (!row) {
      // We never created an internal row for this refund. Possible if
      // someone issued via Stripe Dashboard directly. Log + return —
      // future work could surface these to a queue for back-attribution.
      this.logger.warn(
        `[refund][webhook] no internal row for stripe_refund_id=${refund.id} (issued outside the platform?)`,
      );
      return;
    }

    const newStatus = this.mapStripeStatus(refund.status);
    const prevStatus = row.status;

    // Always refresh the balance_transaction id from the webhook (it
    // may not have been on the initial create response).
    if (refund.balance_transaction) {
      row.stripeBalanceTransactionId =
        typeof refund.balance_transaction === 'object'
          ? refund.balance_transaction.id
          : refund.balance_transaction;
    }
    row.failureReason = refund.failure_reason ?? row.failureReason ?? null;

    // State machine transitions.
    if (prevStatus !== 'succeeded' && newStatus === 'succeeded') {
      // First-time success — post the ledger debit.
      row.status = 'succeeded';
      await this.refunds.save(row);
      await this.postRefundLedgerEntry(row);
      return;
    }

    if (prevStatus === 'succeeded' && newStatus === 'failed') {
      // Race: we'd already posted REFUND. Forward-post a REVERSAL
      // that undoes it. Append-only contract: never mutate the
      // original ledger row.
      this.logger.warn(
        `[refund] succeeded → failed race for ${row.id}; posting REVERSAL ledger entry`,
      );
      row.status = 'failed';
      await this.refunds.save(row);
      await this.postReversalLedgerEntry(row);
      return;
    }

    if (newStatus === 'failed' || newStatus === 'canceled') {
      row.status = newStatus;
      await this.refunds.save(row);
      return;
    }

    // No transition needed — just persist the status snapshot.
    if (newStatus !== prevStatus) {
      row.status = newStatus;
      await this.refunds.save(row);
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────

  async listForOrganization(organizationId: string, limit = 20, offset = 0): Promise<RefundEntity[]> {
    return this.refunds.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async getById(id: string): Promise<RefundEntity> {
    const row = await this.refunds.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Refund ${id} not found`);
    return row;
  }

  // ── Internal ─────────────────────────────────────────────────────

  private async postRefundLedgerEntry(row: RefundEntity): Promise<void> {
    if (!row.creditsReturned || row.creditsReturned <= 0) {
      // Non-credit refund (e.g., subscription proration): nothing to
      // post to the credit ledger; the subscription side handles its
      // own bookkeeping.
      return;
    }
    const entry = await this.ledger.append(
      {
        organizationId: row.organizationId,
        // delta is NEGATIVE because we're REMOVING credits previously
        // granted by the now-refunded purchase.
        deltaCredits: -row.creditsReturned,
        kind: 'REFUND',
        reasonCode: row.reason,
        internalNote: row.internalNote ?? undefined,
        referenceType: 'stripe_refund',
        referenceId: row.stripeRefundId ?? row.id,
        stripeBalanceTransactionId: row.stripeBalanceTransactionId ?? undefined,
        stripeChargeId: row.originalChargeId ?? undefined,
        amountMinorUnits: Number(row.amountMinorUnits),
        currency: row.currency,
        // Refund mirrors the original purchase's tax treatment. Use
        // the most common case (taxed-at-purchase) so reports can net
        // properly. Phase 8 (Stripe Tax) refines this.
        taxTreatment: 'TAXED_AT_PURCHASE',
        idempotencyKey: `refund:${row.id}`,
        metadata: { refundId: row.id },
      },
      {
        kind: 'WEBHOOK',
        userId: row.actorUserId,
        requestId: row.stripeRefundId ?? undefined,
      },
    );
    row.ledgerEntryId = entry.id;
    await this.refunds.save(row);
  }

  private async postReversalLedgerEntry(row: RefundEntity): Promise<void> {
    if (!row.ledgerEntryId || !row.creditsReturned) return;
    const entry = await this.ledger.append(
      {
        organizationId: row.organizationId,
        // Reverse the negative refund: post a POSITIVE delta to restore
        // the org's balance to where it was pre-refund.
        deltaCredits: row.creditsReturned,
        kind: 'REVERSAL',
        reasonCode: 'BILLING_ERROR_CORRECTION',
        internalNote: `Reversal of refund ${row.id} (Stripe flipped to failed after ledger debit)`,
        referenceType: 'credit_ledger',
        referenceId: row.ledgerEntryId,
        idempotencyKey: `refund-reversal:${row.id}`,
        metadata: {
          originalLedgerEntryId: row.ledgerEntryId,
          refundId: row.id,
        },
      },
      { kind: 'WEBHOOK', userId: row.actorUserId },
    );
    row.reversalLedgerEntryId = entry.id;
    await this.refunds.save(row);
  }

  private mapStripeStatus(stripeStatus: string | null | undefined): RefundStatus {
    switch (stripeStatus) {
      case 'succeeded': return 'succeeded';
      case 'failed':    return 'failed';
      case 'canceled':  return 'canceled';
      case 'requires_action': return 'requires_action';
      case 'pending':
      default: return 'pending';
    }
  }

  private toResult(row: RefundEntity): RefundResult {
    return {
      id: row.id,
      organizationId: row.organizationId,
      originalPaymentIntentId: row.originalPaymentIntentId,
      stripeRefundId: row.stripeRefundId,
      amountMinorUnits: Number(row.amountMinorUnits),
      currency: row.currency,
      reason: row.reason,
      status: row.status,
      creditsReturned: row.creditsReturned,
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export interface CreateRefundInput {
  organizationId: string;
  paymentIntentId: string;
  amountMinorUnits?: number;
  reason: RefundReason;
  internalNote?: string;
  currency?: string;
  idempotencyKey?: string;
}

export interface RefundResult {
  id: string;
  organizationId: string;
  originalPaymentIntentId: string;
  stripeRefundId: string | null;
  amountMinorUnits: number;
  currency: string;
  reason: RefundReason;
  status: RefundStatus;
  creditsReturned: number;
  failureReason: string | null;
  createdAt: string;
}
