import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreditPurchaseEntity } from '../entities/credit-purchase.entity';
import { CreditBalanceEntity } from '../entities/credit-balance.entity';
import { StripeService } from './stripe.service';
import { SubscriptionService } from './subscription.service';
import { LedgerService } from './ledger.service';

export interface CreateCreditCheckoutSessionDto {
  organizationId: string;
  credits: number; // 10, 20, 50, 100, or 200
  returnUrl: string; // Full URL from frontend (e.g., https://app.example.com/pricing)
}

export interface CheckoutSessionResponse {
  sessionId: string;
  checkoutUrl: string;
}

/**
 * Credit Purchase Service
 * Handles one-time credit purchases via Stripe Checkout
 */
@Injectable()
export class CreditPurchaseService {
  private readonly logger = new Logger(CreditPurchaseService.name);

  // Credit pricing tiers
  private readonly CREDIT_PRICES: Record<number, number> = {
    10: 5.0,
    20: 9.0,
    50: 20.0,
    100: 35.0,
    200: 60.0,
  };

  constructor(
    @InjectRepository(CreditPurchaseEntity)
    private readonly creditPurchaseRepo: Repository<CreditPurchaseEntity>,
    @InjectRepository(CreditBalanceEntity)
    private readonly creditBalanceRepo: Repository<CreditBalanceEntity>,
    private readonly stripeService: StripeService,
    private readonly subscriptionService: SubscriptionService,
    private readonly ledger: LedgerService,
  ) {}

  /** Phase 1 SHADOW MODE — gated by env flag, default ON. */
  private get shadowWriteEnabled(): boolean {
    return process.env.LEDGER_SHADOW_WRITE !== 'false';
  }

  /**
   * The discrete credit tiers we sell. The SPA shows these as plan
   * cards; arbitrary amounts are not accepted. Keeping tiers small
   * means we can keep the pricing table inline (above) and the SPA
   * UI flat.
   */
  static readonly VALID_TIERS = [10, 20, 50, 100, 200] as const;

  /**
   * Public tier→USD lookup so the controller can validate the request
   * body without re-implementing the pricing table.
   */
  static priceForTier(credits: number): number | null {
    const known: Record<number, number> = {
      10: 5.0,
      20: 9.0,
      50: 20.0,
      100: 35.0,
      200: 60.0,
    };
    return known[credits] ?? null;
  }

  /**
   * One-off Payment Intent flow (Phase 4a). Returns the client_secret
   * for the SPA's Stripe Elements widget. The webhook on
   * payment_intent.succeeded credits the balance — this method does NOT
   * mutate the balance directly.
   *
   * Pending purchase row is written up front so the webhook can match
   * by stripe_payment_intent_id and avoid double-crediting on retry.
   */
  async createPaymentIntentForCredits(params: {
    organizationId: string;
    email: string;
    credits: number;
    paymentMethodId?: string;
  }): Promise<{
    paymentIntentClientSecret: string;
    paymentIntentId: string;
    customerId: string;
    credits: number;
    amountUsd: number;
  }> {
    const price = CreditPurchaseService.priceForTier(params.credits);
    if (price === null) {
      throw new BadRequestException(
        `Invalid credits amount. Must be one of: ${CreditPurchaseService.VALID_TIERS.join(', ')}`,
      );
    }

    const customerId = await this.subscriptionService.getOrCreateStripeCustomer({
      organizationId: params.organizationId,
      email: params.email,
    });

    const intent = await this.stripeService.createPaymentIntent({
      customerId,
      amountUsd: price,
      purpose: 'credit_purchase',
      organizationId: params.organizationId,
      paymentMethodId: params.paymentMethodId,
    });

    // Track the pending purchase. The webhook will move it to
    // 'completed' once Stripe confirms. Storing `creditsAdded` here so
    // the webhook trusts our intent rather than Stripe's metadata
    // (defense-in-depth — Stripe metadata is mutable up until charge).
    const purchase = this.creditPurchaseRepo.create({
      organizationId: params.organizationId,
      credits: params.credits,
      amount: price,
      currency: 'USD',
      status: 'pending',
      returnUrl: '',
      // `stripe_session_id` has a unique index (legacy from the Checkout
      // Session flow). For the Payment Intent path there's no checkout
      // session, so we mirror the intent id here as a unique stable
      // identifier — keeps the constraint happy and the row queryable
      // by either id.
      stripeSessionId: intent.id,
      stripePaymentIntentId: intent.id,
      metadata: { purpose: 'credit_purchase', source: 'portal' },
    });
    await this.creditPurchaseRepo.save(purchase);

    if (!intent.client_secret) {
      throw new BadRequestException(
        'Stripe did not return a client_secret for this Payment Intent',
      );
    }

    return {
      paymentIntentClientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      customerId,
      credits: params.credits,
      amountUsd: price,
    };
  }

  /**
   * Webhook entry point: payment_intent.succeeded. Idempotent by
   * design — we look up the pending purchase row and short-circuit
   * if it's already marked completed.
   */
  async creditFromPaymentIntent(params: {
    paymentIntentId: string;
    organizationId: string;
    credits: number;
  }): Promise<void> {
    const purchase = await this.creditPurchaseRepo.findOne({
      where: { stripePaymentIntentId: params.paymentIntentId },
    });
    if (!purchase) {
      this.logger.warn(
        `[credits] payment_intent.succeeded for unknown intent ${params.paymentIntentId} — ignoring`,
      );
      return;
    }
    if (purchase.status === 'completed') {
      // Stripe sends duplicate webhooks routinely; we MUST be idempotent.
      this.logger.debug(
        `[credits] payment_intent.succeeded replay for ${params.paymentIntentId} — already credited`,
      );
      return;
    }
    if (purchase.organizationId !== params.organizationId) {
      // Defensive: a forged webhook should not be able to credit a
      // different org just by mutating metadata.
      this.logger.error(
        `[credits] org mismatch for intent ${params.paymentIntentId}: ` +
          `purchase=${purchase.organizationId} webhook=${params.organizationId}`,
      );
      return;
    }

    await this.addCredits(params.organizationId, params.credits);

    purchase.status = 'completed';
    purchase.completedAt = new Date();
    await this.creditPurchaseRepo.save(purchase);

    // Phase 1 SHADOW MODE: also write a ledger row. The legacy path
    // above remains the source of truth until LEDGER_AUTHORITY=ledger
    // flips in PR F1.2.
    if (this.shadowWriteEnabled) {
      const purpose = (purchase.metadata as { purpose?: string } | undefined)?.purpose;
      const kind = purpose === 'auto_topup' ? 'AUTO_TOPUP' : 'PURCHASE';
      await this.ledger.shadowAppend(
        {
          organizationId: params.organizationId,
          deltaCredits: params.credits,
          kind,
          referenceType: 'stripe_payment_intent',
          referenceId: params.paymentIntentId,
          amountMinorUnits: Math.round(Number(purchase.amount) * 100),
          currency: purchase.currency,
          taxTreatment: 'TAXED_AT_PURCHASE',
          metadata: { purpose },
        },
        { kind: 'WEBHOOK', requestId: params.paymentIntentId },
      );
    }
  }

  /** Returns the most recent N completed credit purchases for the org. */
  async listRecentPurchases(organizationId: string, limit = 20) {
    return this.creditPurchaseRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Create a Stripe Checkout Session for credit purchase
   */
  async createCheckoutSession(
    dto: CreateCreditCheckoutSessionDto,
  ): Promise<CheckoutSessionResponse> {
    // Validate credit amount
    const price = this.CREDIT_PRICES[dto.credits];
    if (!price) {
      throw new BadRequestException(
        `Invalid credit amount. Must be one of: ${Object.keys(this.CREDIT_PRICES).join(', ')}`,
      );
    }

    this.logger.log(
      `Creating checkout session for ${dto.credits} credits ($${price}) for org ${dto.organizationId}`,
    );

    // Create pending credit purchase record
    const purchase = this.creditPurchaseRepo.create({
      organizationId: dto.organizationId,
      credits: dto.credits,
      amount: price,
      currency: 'USD',
      status: 'pending',
      returnUrl: dto.returnUrl,
      stripeSessionId: '', // Will be updated after Stripe session creation
    });
    await this.creditPurchaseRepo.save(purchase);

    // Get base URL from environment
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';

    // Create Stripe Checkout Session
    const session = await this.stripeService.createFlexibleCheckoutSession({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${dto.credits} API Credits`,
              description: `One-time purchase of ${dto.credits} classification credits`,
            },
            unit_amount: Math.round(price * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/api/v1/billing/credits/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/api/v1/billing/credits/checkout/cancel?session_id={CHECKOUT_SESSION_ID}`,
      client_reference_id: purchase.id, // Link session to our purchase record
      metadata: {
        purchaseId: purchase.id,
        organizationId: dto.organizationId,
        credits: dto.credits.toString(),
        type: 'credit_purchase',
      },
    });

    // Update purchase with Stripe session ID
    purchase.stripeSessionId = session.id;
    await this.creditPurchaseRepo.save(purchase);

    this.logger.log(
      `Created Stripe session ${session.id} for purchase ${purchase.id}`,
    );

    return {
      sessionId: session.id,
      checkoutUrl: session.url!,
    };
  }

  /**
   * Handle successful checkout
   * Called when Stripe redirects back after successful payment
   */
  async handleCheckoutSuccess(sessionId: string): Promise<{
    success: boolean;
    returnUrl: string;
    credits: number;
  }> {
    this.logger.log(`Handling checkout success for session ${sessionId}`);

    // Find purchase by session ID
    const purchase = await this.creditPurchaseRepo.findOne({
      where: { stripeSessionId: sessionId },
    });

    if (!purchase) {
      this.logger.error(`Purchase not found for session ${sessionId}`);
      throw new BadRequestException('Purchase not found');
    }

    // Skip if already completed
    if (purchase.status === 'completed') {
      this.logger.log(`Purchase ${purchase.id} already completed`);
      return {
        success: true,
        returnUrl: `${purchase.returnUrl}?success=true&credits=${purchase.credits}`,
        credits: purchase.credits,
      };
    }

    // Retrieve session from Stripe to verify payment
    const session = await this.stripeService.retrieveSession(sessionId);

    if (session.payment_status === 'paid') {
      // Update purchase status
      purchase.status = 'completed';
      purchase.completedAt = new Date();
      purchase.stripePaymentIntentId = session.payment_intent as string;
      await this.creditPurchaseRepo.save(purchase);

      // Add credits to balance
      await this.addCredits(purchase.organizationId, purchase.credits);

      this.logger.log(
        `Purchase ${purchase.id} completed: ${purchase.credits} credits added to org ${purchase.organizationId}`,
      );

      return {
        success: true,
        returnUrl: `${purchase.returnUrl}?success=true&credits=${purchase.credits}`,
        credits: purchase.credits,
      };
    } else {
      // Payment not completed
      purchase.status = 'failed';
      await this.creditPurchaseRepo.save(purchase);

      this.logger.warn(`Payment not completed for session ${sessionId}`);

      return {
        success: false,
        returnUrl: `${purchase.returnUrl}?success=false&error=payment_incomplete`,
        credits: 0,
      };
    }
  }

  /**
   * Handle cancelled checkout
   */
  async handleCheckoutCancel(sessionId: string): Promise<{
    success: boolean;
    returnUrl: string;
  }> {
    this.logger.log(`Handling checkout cancellation for session ${sessionId}`);

    const purchase = await this.creditPurchaseRepo.findOne({
      where: { stripeSessionId: sessionId },
    });

    if (!purchase) {
      throw new BadRequestException('Purchase not found');
    }

    // Update status to failed
    purchase.status = 'failed';
    purchase.metadata = {
      ...purchase.metadata,
      cancelledAt: new Date().toISOString(),
    };
    await this.creditPurchaseRepo.save(purchase);

    return {
      success: false,
      returnUrl: `${purchase.returnUrl}?success=false&cancelled=true`,
    };
  }

  /**
   * Add credits to organization balance
   */
  private async addCredits(
    organizationId: string,
    credits: number,
  ): Promise<void> {
    // Find or create credit balance
    let balance = await this.creditBalanceRepo.findOne({
      where: { organizationId },
    });

    if (!balance) {
      balance = this.creditBalanceRepo.create({
        organizationId,
        balance: 0,
        lifetimePurchased: 0,
        lifetimeUsed: 0,
      });
    }

    // Update balance
    balance.balance += credits;
    balance.lifetimePurchased += credits;
    balance.lastPurchaseAt = new Date();

    await this.creditBalanceRepo.save(balance);

    this.logger.log(
      `Added ${credits} credits to org ${organizationId}. New balance: ${balance.balance}`,
    );
  }

  /**
   * Get credit balance for organization
   */
  async getBalance(organizationId: string): Promise<number> {
    const balance = await this.creditBalanceRepo.findOne({
      where: { organizationId },
    });

    return balance?.balance || 0;
  }

  /**
   * Deduct credits atomically.
   *
   * Implemented as a single conditional UPDATE so concurrent callers can't
   * over-deduct. Returns the post-deduction balance when successful, or
   * `null` when the org doesn't have enough credits (or no row at all).
   *
   * Use this for any per-call metered billing. Webhook retries and
   * parallel webhook deliveries land here, so atomicity is mandatory.
   */
  async deductCredits(
    organizationId: string,
    amount: number = 1,
  ): Promise<{ balance: number; lifetimeUsed: number } | null> {
    if (amount <= 0) {
      throw new BadRequestException('deductCredits amount must be positive');
    }

    const result = await this.creditBalanceRepo
      .createQueryBuilder()
      .update(CreditBalanceEntity)
      .set({
        balance: () => `balance - ${Number(amount)}`,
        lifetimeUsed: () => `lifetime_used + ${Number(amount)}`,
        lastUsedAt: () => 'NOW()',
        updatedAt: () => 'NOW()',
      })
      .where('organization_id = :orgId', { orgId: organizationId })
      .andWhere('balance >= :amount', { amount })
      .returning(['balance', 'lifetime_used'])
      .execute();

    const raw = (result.raw as Array<{ balance: number; lifetime_used: number }>) ?? [];
    if (raw.length === 0) return null;

    // Phase 1 SHADOW MODE: write a matching USAGE_DEBIT ledger row.
    // Best-effort — errors are swallowed at the shadow layer.
    if (this.shadowWriteEnabled) {
      await this.ledger.shadowAppend(
        {
          organizationId,
          deltaCredits: -amount,
          kind: 'USAGE_DEBIT',
          referenceType: 'deductCredits',
        },
        { kind: 'SYSTEM' },
      );
    }

    return {
      balance: Number(raw[0].balance),
      lifetimeUsed: Number(raw[0].lifetime_used),
    };
  }

  /**
   * Ensure a credit_balances row exists for the org. Used by:
   *   - signup flow (initial bonus credits)
   *   - shadow-mode charge path (so the merchant has a balance to look at)
   *
   * Idempotent. Returns the row (existing or newly created).
   */
  async ensureBalanceRow(
    organizationId: string,
    initialCredits: number = 0,
  ): Promise<CreditBalanceEntity> {
    const existing = await this.creditBalanceRepo.findOne({
      where: { organizationId },
    });
    if (existing) return existing;

    const row = this.creditBalanceRepo.create({
      organizationId,
      balance: initialCredits,
      lifetimePurchased: initialCredits,
      lifetimeUsed: 0,
      lastPurchaseAt: initialCredits > 0 ? new Date() : null,
    });
    return this.creditBalanceRepo.save(row);
  }

  /** Read-only convenience: full balance row or null. */
  async getBalanceRow(
    organizationId: string,
  ): Promise<CreditBalanceEntity | null> {
    return this.creditBalanceRepo.findOne({ where: { organizationId } });
  }
}
