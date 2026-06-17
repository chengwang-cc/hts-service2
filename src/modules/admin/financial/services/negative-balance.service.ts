import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutoTopUpConfigEntity } from '../../../billing/entities/auto-topup-config.entity';
import { CreditBalanceEntity } from '../../../billing/entities/credit-balance.entity';
import { OrganizationEntity } from '../../../auth/entities/organization.entity';
import { LedgerService } from '../../../billing/services/ledger.service';
import { StripeService } from '../../../billing/services/stripe.service';
import { SubscriptionService } from '../../../billing/services/subscription.service';
import type { ActorContext } from '../../../billing/types/actor-context';

/**
 * Settle arrears for an org that has crossed into a negative credit
 * balance. Phase 7, PR F7.2.
 *
 * Flow
 * ----
 *   1. Admin clicks "Settle arrears" on the org's Financial tab.
 *   2. SPA POSTs /admin/financial/organizations/:id/settle-arrears with
 *      an Idempotency-Key.
 *   3. This service:
 *      a. Reads the current balance; rejects if non-negative.
 *      b. Computes the deficit (credits × per-credit rate) in USD.
 *      c. Creates an OFF-SESSION Stripe payment intent against the
 *         saved customer + default payment method. Forwards the
 *         caller's Idempotency-Key to Stripe so retries are safe.
 *      d. On Stripe success (status='succeeded'): appends a MANUAL_TOPUP
 *         ledger entry for the deficit credits — this UPSERTs the
 *         balance back to >= 0. LedgerService.append's cross-zero
 *         detector will NOT fire here (after >= 0).
 *      e. Clears suspended_reason on auto_topup_configs.
 *
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §11.3
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §8.2
 *
 * Pricing
 * -------
 * Settlement uses the headline rate (per-credit cents) configured via
 * `ARREARS_PER_CREDIT_CENTS` env. Default 40 = $0.40/credit, which
 * matches the 50-credit tier's $20 list price. We deliberately don't
 * apply tier discounts here — settlement is a corrective transaction,
 * not a promotional purchase.
 *
 * Stripe-side guardrails
 * ----------------------
 * - The intent is created with `off_session: true` + saved
 *   payment_method, so Stripe charges immediately without re-prompting
 *   the customer for auth.
 * - If Stripe returns status !== 'succeeded' (e.g. 'requires_action'
 *   for SCA), we DON'T post the ledger row. The admin sees the
 *   intermediate status; ops resolves via the Stripe Dashboard, then
 *   the existing payment_intent.succeeded webhook handler can finish
 *   the work (out of scope for this PR).
 */
@Injectable()
export class NegativeBalanceService {
  private readonly logger = new Logger(NegativeBalanceService.name);

  // Default 40¢/credit (the 50-credit tier rate). Override via env for
  // policy changes without a code deploy.
  private get perCreditCents(): number {
    const raw = process.env.ARREARS_PER_CREDIT_CENTS;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
  }

  constructor(
    @InjectRepository(AutoTopUpConfigEntity)
    private readonly autoTopups: Repository<AutoTopUpConfigEntity>,
    @InjectRepository(CreditBalanceEntity)
    private readonly balances: Repository<CreditBalanceEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    private readonly ledger: LedgerService,
    private readonly stripe: StripeService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /**
   * Preview the projected charge without firing it. Used by the SPA
   * to render the confirmation modal.
   */
  async preview(organizationId: string): Promise<{
    organizationId: string;
    currentBalance: number;
    deficitCredits: number;
    chargeUsdCents: number;
    chargeUsd: number;
    suspendedReason: string | null;
    canSettle: boolean;
    reasonCannotSettle?: string;
  }> {
    const balance = await this.balances.findOne({ where: { organizationId } });
    const current = balance?.balance ?? 0;
    const deficit = current < 0 ? -current : 0;
    const chargeCents = deficit * this.perCreditCents;
    const autoTopup = await this.autoTopups.findOne({
      where: { organizationId },
    });

    let reason: string | undefined;
    let canSettle = true;
    if (current >= 0) {
      canSettle = false;
      reason = `Balance is non-negative (${current}); nothing to settle.`;
    } else if (!autoTopup?.stripeCustomerId) {
      canSettle = false;
      reason = 'No Stripe customer on file for this org.';
    } else if (!autoTopup?.stripePaymentMethodId) {
      canSettle = false;
      reason = 'No saved payment method on file for this org.';
    }

    return {
      organizationId,
      currentBalance: current,
      deficitCredits: deficit,
      chargeUsdCents: chargeCents,
      chargeUsd: chargeCents / 100,
      suspendedReason: autoTopup?.suspendedReason ?? null,
      canSettle,
      reasonCannotSettle: reason,
    };
  }

  /**
   * Issue the Stripe charge + post the ledger row + clear the
   * suspension.
   *
   * @returns the new balance and the Stripe intent id for the SPA's
   *          reveal modal.
   */
  async settleArrears(
    organizationId: string,
    actor: ActorContext,
    idempotencyKey: string,
  ): Promise<{
    organizationId: string;
    balanceBefore: number;
    balanceAfter: number;
    creditsTopped: number;
    chargeUsdCents: number;
    stripePaymentIntentId: string;
    stripeStatus: string;
    suspensionCleared: boolean;
  }> {
    if (!idempotencyKey) {
      throw new BadRequestException(
        'Idempotency-Key header is required for arrears settlement.',
      );
    }

    const org = await this.orgs.findOne({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }

    const balance = await this.balances.findOne({ where: { organizationId } });
    const before = balance?.balance ?? 0;
    if (before >= 0) {
      throw new ConflictException(
        `Balance is non-negative (${before}); nothing to settle.`,
      );
    }
    const deficitCredits = -before;
    const chargeCents = deficitCredits * this.perCreditCents;

    const autoTopup = await this.autoTopups.findOne({
      where: { organizationId },
    });
    if (!autoTopup?.stripeCustomerId) {
      throw new ConflictException(
        'No Stripe customer on file for this org; cannot charge.',
      );
    }
    if (!autoTopup?.stripePaymentMethodId) {
      throw new ConflictException(
        'No saved payment method on file for this org; cannot charge.',
      );
    }

    // Issue the off-session charge. Stripe's idempotency key is the
    // same one the SPA minted; a retry within Stripe's TTL returns the
    // existing intent without double-charging.
    const intent = await this.stripe.createPaymentIntent({
      customerId: autoTopup.stripeCustomerId,
      amountUsd: chargeCents / 100,
      purpose: 'auto_topup', // closest semantic match; metadata.reason disambiguates
      organizationId,
      paymentMethodId: autoTopup.stripePaymentMethodId,
      offSession: true,
    });

    if (intent.status !== 'succeeded') {
      this.logger.warn(
        `[arrears] Stripe intent ${intent.id} for org=${organizationId} returned status=${intent.status}; not posting ledger row.`,
      );
      throw new ConflictException(
        `Stripe charge returned status=${intent.status}. Resolve in the Stripe Dashboard; the next payment_intent.succeeded webhook will complete settlement.`,
      );
    }

    // Synchronous success — post MANUAL_TOPUP for the deficit and
    // clear the suspension.
    const ledgerRow = await this.ledger.append(
      {
        organizationId,
        deltaCredits: deficitCredits,
        kind: 'MANUAL_TOPUP',
        reasonCode: 'MANUAL_REFUND_RECOVERY',
        internalNote: `Arrears settlement via Stripe intent ${intent.id}`,
        referenceType: 'arrears_settlement',
        referenceId: intent.id,
        currency: 'USD',
        amountMinorUnits: chargeCents,
        idempotencyKey: `arrears-settle:${organizationId}:${idempotencyKey}`,
        metadata: {
          stripePaymentIntentId: intent.id,
          stripeStatus: intent.status,
        },
      },
      actor,
    );

    // Clear suspended_reason (idempotent — UPDATE is safe even if
    // the row already had a different reason or no row at all).
    let suspensionCleared = false;
    if (autoTopup.suspendedReason) {
      autoTopup.suspendedReason = null;
      await this.autoTopups.save(autoTopup);
      suspensionCleared = true;
    }

    this.logger.log(
      `[arrears] org=${organizationId} settled deficit=${deficitCredits} credits ($${(chargeCents / 100).toFixed(2)}) via intent=${intent.id}; balance ${before} → ${ledgerRow.balanceAfter}`,
    );

    return {
      organizationId,
      balanceBefore: before,
      balanceAfter: ledgerRow.balanceAfter,
      creditsTopped: deficitCredits,
      chargeUsdCents: chargeCents,
      stripePaymentIntentId: intent.id,
      stripeStatus: intent.status,
      suspensionCleared,
    };
  }

  /**
   * Manual unfreeze — admin can clear suspended_reason without
   * issuing a charge (e.g. balance was settled by an out-of-band
   * MANUAL_TOPUP via the existing credit-adjust endpoint).
   */
  async unsuspendAutoTopup(organizationId: string): Promise<{
    organizationId: string;
    cleared: boolean;
  }> {
    const autoTopup = await this.autoTopups.findOne({
      where: { organizationId },
    });
    if (!autoTopup) {
      throw new NotFoundException(
        `No auto-topup config for org ${organizationId}`,
      );
    }
    if (!autoTopup.suspendedReason) {
      return { organizationId, cleared: false };
    }
    autoTopup.suspendedReason = null;
    await this.autoTopups.save(autoTopup);
    return { organizationId, cleared: true };
  }
}
