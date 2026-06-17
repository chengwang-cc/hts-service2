import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type Stripe from 'stripe';
import {
  DisputeEntity,
  DisputeInternalState,
  DisputeStripeStatus,
} from '../../entities/dispute.entity';
import { CreditPurchaseEntity } from '../../entities/credit-purchase.entity';
import { StripeService } from '../../services/stripe.service';
import { LedgerService } from '../../services/ledger.service';
import { AutoTopupService } from '../../services/auto-topup.service';
import type { ActorContext } from '../../types/actor-context';

/**
 * Stripe dispute (chargeback) ingestion + internal workflow state.
 *
 * Phase 5 of the financial management rollout (PR F5.1).
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §9
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §6.1
 *
 * Two flows:
 *
 *  1. onDisputeEvent(event) — invoked from the webhook switch.
 *     - charge.dispute.created          → INSERT disputes row, freeze
 *       auto_topup_configs.enabled (chargebacks usually indicate a
 *       compromised payment method).
 *     - charge.dispute.funds_withdrawn  → append CHARGEBACK ledger row
 *       debiting the org for the lost amount + store
 *       chargeback_ledger_entry_id.
 *     - charge.dispute.updated          → UPDATE stripe_status,
 *       evidence_due_by, evidence bag.
 *     - charge.dispute.closed (won)     → append REVERSAL row that
 *       undoes the CHARGEBACK; internal_state=WON.
 *     - charge.dispute.closed (lost)    → internal_state=LOST. No
 *       reversal; the CHARGEBACK stands.
 *     - charge.dispute.funds_reinstated → confirmation event for won
 *       disputes. Idempotent — we either no-op (REVERSAL already
 *       posted by `closed`) or stamp `funds_reinstated_at` if missing.
 *
 *  2. submitEvidence(disputeId, evidence, actor) — invoked from the
 *     admin POST /admin/financial/disputes/:id/respond endpoint.
 *     - Calls stripe.disputes.update(stripeId, { evidence, submit:true })
 *       with our idempotency key.
 *     - Flips internal_state=EVIDENCE_SUBMITTED + bumps submission_count.
 *     - Stripe rejects a second submit, so we also gate on
 *       submission_count > 0 (defense-in-depth).
 *
 * Ledger entries (append-only by trigger):
 *
 *   - CHARGEBACK: delta = -credits_attached_to_charge (computed from
 *     the matching credit_purchases row; if none exists we fall back
 *     to delta = 0 and log a warning — disputes against subscription
 *     charges don't have a credit pack to revoke).
 *
 *   - REVERSAL: delta = +credits_attached_to_charge, referencing the
 *     CHARGEBACK row via reference_id.
 *
 * Never mutate the CHARGEBACK row — we forward-post REVERSAL.
 */
@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    @InjectRepository(DisputeEntity)
    private readonly disputes: Repository<DisputeEntity>,
    @InjectRepository(CreditPurchaseEntity)
    private readonly purchases: Repository<CreditPurchaseEntity>,
    private readonly stripe: StripeService,
    private readonly ledger: LedgerService,
    private readonly autoTopup: AutoTopupService,
  ) {}

  /**
   * Public read methods used by the admin SPA list + detail pages.
   */

  async listOpen(limit = 50, offset = 0): Promise<DisputeEntity[]> {
    return this.disputes
      .createQueryBuilder('d')
      .where("d.internalState IN ('OPEN','EVIDENCE_DRAFTING','EVIDENCE_SUBMITTED')")
      .orderBy('d.evidenceDueBy', 'ASC', 'NULLS LAST')
      .take(limit)
      .skip(offset)
      .getMany();
  }

  async listForOrganization(
    organizationId: string,
    limit = 50,
    offset = 0,
  ): Promise<DisputeEntity[]> {
    return this.disputes.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async getById(id: string): Promise<DisputeEntity> {
    const row = await this.disputes.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Dispute not found: ${id}`);
    }
    return row;
  }

  /**
   * Webhook entry point. Routes to the per-event handler based on
   * event type. Idempotent — same event id replayed produces the
   * same end-state.
   */
  async onDisputeEvent(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;
    if (!dispute?.id) {
      this.logger.warn(`[dispute] event ${event.id} has no dispute object`);
      return;
    }

    switch (event.type) {
      case 'charge.dispute.created':
        await this.onDisputeCreated(dispute);
        return;
      case 'charge.dispute.funds_withdrawn':
        await this.onFundsWithdrawn(dispute);
        return;
      case 'charge.dispute.funds_reinstated':
        await this.onFundsReinstated(dispute);
        return;
      case 'charge.dispute.updated':
        await this.onDisputeUpdated(dispute);
        return;
      case 'charge.dispute.closed':
        await this.onDisputeClosed(dispute);
        return;
      default:
        this.logger.debug(
          `[dispute] unhandled event type ${event.type} for ${dispute.id}`,
        );
    }
  }

  // ── Webhook handlers ──────────────────────────────────────────────

  private async onDisputeCreated(d: Stripe.Dispute): Promise<void> {
    const existing = await this.disputes.findOne({
      where: { stripeDisputeId: d.id },
    });
    if (existing) {
      this.logger.debug(`[dispute] created replay for ${d.id} — no-op`);
      return;
    }

    const organizationId = await this.lookupOrganizationFromCharge(d);
    if (!organizationId) {
      this.logger.error(
        `[dispute] cannot map charge ${d.charge as string} to an org; dropping ${d.id}`,
      );
      return;
    }

    const row = this.disputes.create({
      organizationId,
      stripeDisputeId: d.id,
      stripeChargeId: typeof d.charge === 'string' ? d.charge : d.charge?.id,
      stripePaymentIntentId:
        typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id ?? null,
      amountMinorUnits: String(d.amount),
      currency: (d.currency || 'usd').toUpperCase(),
      reason: d.reason ?? 'unknown',
      stripeStatus: d.status as DisputeStripeStatus,
      internalState: 'OPEN' as DisputeInternalState,
      evidenceDueBy: d.evidence_details?.due_by
        ? new Date(d.evidence_details.due_by * 1000)
        : null,
      submissionCount: 0,
      isChargeRefundable: d.is_charge_refundable ?? false,
      evidence: (d.evidence as unknown as Record<string, unknown>) ?? {},
    });
    await this.disputes.save(row);

    // Freeze auto-topup — chargebacks usually mean a compromised card.
    try {
      await this.autoTopup.disable(organizationId);
    } catch (err) {
      // Best-effort: never let auto-topup state block dispute landing.
      this.logger.warn(
        `[dispute] failed to freeze auto-topup for org=${organizationId}: ${(err as Error).message}`,
      );
    }
  }

  private async onFundsWithdrawn(d: Stripe.Dispute): Promise<void> {
    const row = await this.disputes.findOne({
      where: { stripeDisputeId: d.id },
    });
    if (!row) {
      this.logger.warn(`[dispute] funds_withdrawn for unknown dispute ${d.id}`);
      return;
    }
    if (row.fundsWithdrawnAt) {
      this.logger.debug(`[dispute] funds_withdrawn replay for ${d.id} — no-op`);
      return;
    }

    const creditsToReverse = await this.creditsAttachedToCharge(row);
    const ledgerRow = await this.ledger.append(
      {
        organizationId: row.organizationId,
        deltaCredits: -creditsToReverse,
        kind: 'CHARGEBACK',
        referenceType: 'dispute',
        referenceId: row.id,
        stripeChargeId: row.stripeChargeId,
        amountMinorUnits: Number(row.amountMinorUnits),
        currency: row.currency,
        idempotencyKey: `dispute-chargeback:${row.id}`,
        metadata: { stripeDisputeId: d.id },
      },
      this.webhookActor(d),
    );

    row.fundsWithdrawnAt = new Date();
    row.chargebackLedgerEntryId = ledgerRow.id;
    await this.disputes.save(row);
  }

  private async onFundsReinstated(d: Stripe.Dispute): Promise<void> {
    const row = await this.disputes.findOne({
      where: { stripeDisputeId: d.id },
    });
    if (!row) {
      this.logger.warn(
        `[dispute] funds_reinstated for unknown dispute ${d.id}`,
      );
      return;
    }
    if (!row.fundsReinstatedAt) {
      row.fundsReinstatedAt = new Date();
      await this.disputes.save(row);
    }
    // The REVERSAL ledger row is posted by onDisputeClosed when status=won;
    // funds_reinstated arrives later as a confirmation. If we somehow
    // haven't posted REVERSAL yet (out-of-order events), post it now.
    if (row.chargebackLedgerEntryId && !row.reversalLedgerEntryId) {
      await this.postReversal(row, d);
    }
  }

  private async onDisputeUpdated(d: Stripe.Dispute): Promise<void> {
    const row = await this.disputes.findOne({
      where: { stripeDisputeId: d.id },
    });
    if (!row) {
      // Stripe may send `updated` before `created` lands; fetch +
      // bootstrap if so.
      await this.onDisputeCreated(d);
      return;
    }

    row.stripeStatus = d.status as DisputeStripeStatus;
    if (d.evidence_details?.due_by) {
      row.evidenceDueBy = new Date(d.evidence_details.due_by * 1000);
    }
    if (d.evidence) {
      row.evidence = d.evidence as unknown as Record<string, unknown>;
    }
    row.isChargeRefundable = d.is_charge_refundable ?? row.isChargeRefundable;
    await this.disputes.save(row);
  }

  private async onDisputeClosed(d: Stripe.Dispute): Promise<void> {
    const row = await this.disputes.findOne({
      where: { stripeDisputeId: d.id },
    });
    if (!row) {
      this.logger.warn(`[dispute] closed for unknown dispute ${d.id}`);
      return;
    }

    const status = d.status;
    row.stripeStatus = status as DisputeStripeStatus;

    if (status === 'won' || status === 'warning_closed') {
      row.internalState = 'WON';
      if (row.chargebackLedgerEntryId && !row.reversalLedgerEntryId) {
        await this.postReversal(row, d);
      }
    } else if (status === 'lost') {
      row.internalState = 'LOST';
    } else {
      // 'prevented' or transient — leave state as-is.
      this.logger.debug(
        `[dispute] closed event for ${d.id} with non-terminal status ${status}`,
      );
    }
    await this.disputes.save(row);
  }

  /**
   * Post a forward REVERSAL row that undoes a prior CHARGEBACK. Called
   * either from onDisputeClosed (the common path) or onFundsReinstated
   * (recovery path for out-of-order events).
   */
  private async postReversal(
    row: DisputeEntity,
    d: Stripe.Dispute,
  ): Promise<void> {
    if (!row.chargebackLedgerEntryId) return;
    const creditsToReturn = await this.creditsAttachedToCharge(row);
    const ledgerRow = await this.ledger.append(
      {
        organizationId: row.organizationId,
        deltaCredits: creditsToReturn,
        kind: 'REVERSAL',
        referenceType: 'credit_ledger',
        referenceId: row.chargebackLedgerEntryId,
        amountMinorUnits: Number(row.amountMinorUnits),
        currency: row.currency,
        idempotencyKey: `dispute-reversal:${row.id}`,
        metadata: { stripeDisputeId: d.id },
      },
      this.webhookActor(d),
    );
    row.reversalLedgerEntryId = ledgerRow.id;
  }

  // ── Admin actions ─────────────────────────────────────────────────

  /**
   * Submit evidence to Stripe. The caller MUST pass an idempotency key
   * — the SPA mints a UUID v4 on form mount.
   */
  async submitEvidence(
    disputeId: string,
    evidence: Stripe.DisputeUpdateParams.Evidence,
    actor: ActorContext,
    idempotencyKey: string,
  ): Promise<DisputeEntity> {
    if (!idempotencyKey) {
      throw new BadRequestException(
        'Idempotency-Key header is required for evidence submission',
      );
    }

    const row = await this.getById(disputeId);

    // Hard refuse if we've already submitted — Stripe allows ONE
    // submission per dispute. This is also the second layer of the
    // double-click guard; the controller's IdempotencyInterceptor is
    // the first.
    if (row.submissionCount >= 1) {
      throw new ConflictException(
        `Dispute ${disputeId} already has evidence submitted (count=${row.submissionCount}). Stripe allows one submission per dispute.`,
      );
    }
    if (row.internalState === 'WON' || row.internalState === 'LOST') {
      throw new ConflictException(
        `Dispute ${disputeId} is already closed (${row.internalState}); cannot submit evidence.`,
      );
    }

    const submitted = await this.stripe.submitDisputeEvidence({
      disputeId: row.stripeDisputeId,
      evidence,
      submit: true,
      idempotencyKey,
    });

    row.stripeStatus = submitted.status as DisputeStripeStatus;
    row.evidence = (submitted.evidence as unknown as Record<string, unknown>) ?? row.evidence;
    row.internalState = 'EVIDENCE_SUBMITTED';
    row.submissionCount += 1;
    row.submissionIdempotencyKey = idempotencyKey;
    await this.disputes.save(row);

    this.logger.log(
      `[dispute] evidence submitted by user=${actor.userId} for ${row.stripeDisputeId} (sub_count=${row.submissionCount})`,
    );
    return row;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  /**
   * Map a Stripe charge back to one of our organizations via the
   * credit_purchases row that recorded the original payment. If the
   * charge came from a subscription invoice instead (not a credit
   * purchase), returns null and the caller drops the event.
   *
   * Future iterations could walk through `invoices` for subscription
   * disputes; for now we narrowly scope to credit purchases since
   * those are the only chargeback-prone surface.
   */
  private async lookupOrganizationFromCharge(d: Stripe.Dispute): Promise<string | null> {
    const paymentIntentId =
      typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id;
    if (!paymentIntentId) return null;
    const purchase = await this.purchases.findOne({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    return purchase?.organizationId ?? null;
  }

  /**
   * Credits attached to the disputed charge. Looked up via the
   * credit_purchases row keyed on payment_intent_id; 0 if the dispute
   * is against a subscription invoice (no credit pack to reverse).
   */
  private async creditsAttachedToCharge(row: DisputeEntity): Promise<number> {
    if (!row.stripePaymentIntentId) return 0;
    const purchase = await this.purchases.findOne({
      where: { stripePaymentIntentId: row.stripePaymentIntentId },
    });
    return purchase?.credits ?? 0;
  }

  private webhookActor(d: Stripe.Dispute): ActorContext {
    return {
      kind: 'WEBHOOK',
      requestId: d.id, // Stripe dispute id as the trace anchor
    };
  }
}
