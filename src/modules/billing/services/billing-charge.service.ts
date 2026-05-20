/**
 * BillingChargeService
 *
 * Phase 4 of the Shopify refactor (see docs/2026-05-20/0747_phase-4-metered-billing.md).
 *
 * Single entry point for every metered API call. Owns the atomic deduction
 * + usage-record audit row, and respects the BILLING_ENABLED flag so we
 * can ship in shadow mode and flip a single env var to go live.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditPurchaseService } from './credit-purchase.service';
import { UsageTrackingService } from './usage-tracking.service';

export type BillableEvent = 'DUTY_CALCULATION' | 'PRODUCT_CLASSIFICATION';

export interface ChargeOutcome {
  /** Whether real credits were deducted. False in shadow mode and on insufficient balance. */
  charged: boolean;
  /** Whether the system is in shadow mode (logged-only, no real deduction). */
  shadow: boolean;
  /** Post-deduction balance (or current balance if no deduction happened). */
  balance: number;
  /** Credits this charge would have / did consume. */
  costCredits: number;
  /** Reason set only when charged=false in BILLING_ENABLED=true mode. */
  reason?: 'insufficient_credits' | 'no_balance_row';
}

@Injectable()
export class BillingChargeService {
  private readonly logger = new Logger(BillingChargeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly credits: CreditPurchaseService,
    private readonly usage: UsageTrackingService,
  ) {}

  /**
   * Run before / after a billable API call. Atomic by construction:
   *   1. In shadow mode → write a usage_records row tagged shadow=true and
   *      report what *would* have been charged. Balance untouched.
   *   2. In live mode → conditional UPDATE on credit_balances. If the
   *      UPDATE affects one row, we deducted; write the audit row and
   *      return the new balance. If it affects zero rows, the caller
   *      decides whether to fail open or hard-fail (we recommend fail
   *      open for webhook-driven work — the metafield + DB row still
   *      get written; the order shows up unbilled).
   */
  async chargeForEvent(
    organizationId: string,
    event: BillableEvent,
    metadata: Record<string, unknown> = {},
  ): Promise<ChargeOutcome> {
    const cost = this.perCallCredits();
    const billingEnabled = this.isBillingEnabled();

    if (!billingEnabled) {
      const row = await this.credits.getBalanceRow(organizationId);
      await this.usage.trackUsage(organizationId, event, cost, {
        ...metadata,
        shadow: true,
        would_charge: cost,
        per_credit_cents: this.perCreditCents(),
      });
      return {
        charged: false,
        shadow: true,
        balance: row?.balance ?? 0,
        costCredits: cost,
      };
    }

    const deducted = await this.credits.deductCredits(organizationId, cost);
    if (!deducted) {
      const row = await this.credits.getBalanceRow(organizationId);
      const reason: ChargeOutcome['reason'] = row
        ? 'insufficient_credits'
        : 'no_balance_row';
      this.logger.warn(
        `[billing] ${reason} for org=${organizationId} event=${event} cost=${cost}`,
      );
      return {
        charged: false,
        shadow: false,
        balance: row?.balance ?? 0,
        costCredits: cost,
        reason,
      };
    }

    await this.usage.trackUsage(organizationId, event, cost, {
      ...metadata,
      per_credit_cents: this.perCreditCents(),
    });

    return {
      charged: true,
      shadow: false,
      balance: deducted.balance,
      costCredits: cost,
    };
  }

  /** Per-call cost in credits. Default 1. */
  perCallCredits(): number {
    const raw = this.config.get<string | number>(
      'BILLING_PRICE_PER_CALL_CREDITS',
      1,
    );
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /** Cash price per credit in cents (for display only). Default 10 (=$0.10). */
  perCreditCents(): number {
    const raw = this.config.get<string | number>(
      'BILLING_PRICE_PER_CREDIT_CENTS',
      10,
    );
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n >= 0 ? n : 10;
  }

  /** How many credits a brand-new org gets at signup. Default 50 (=$5). */
  signupBonusCredits(): number {
    const raw = this.config.get<string | number>(
      'BILLING_FREE_SIGNUP_CREDITS',
      50,
    );
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n >= 0 ? n : 50;
  }

  /**
   * Flip with the `BILLING_ENABLED` env var on the ECS task. False (shadow
   * mode) is the deliberate default — we ship the wiring, observe, then
   * flip the var.
   */
  isBillingEnabled(): boolean {
    const raw = this.config.get<string>('BILLING_ENABLED', 'false');
    return String(raw).toLowerCase() === 'true';
  }
}
