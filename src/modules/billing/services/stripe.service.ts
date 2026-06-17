import { Injectable, Inject } from '@nestjs/common';
import Stripe from 'stripe';

/**
 * Stripe Tax tax_code for general SaaS.
 *
 * Phase 8 (PR F8.1).
 *
 * NOTE: TAX-CODE SELECTION IS PENDING TAX COUNSEL REVIEW.
 *   - `txcd_10000000` = general SaaS, the design doc's recommendation.
 *   - Counsel may pick a different code (e.g. region-specific). Until
 *     they confirm, this PR ships dark behind `STRIPE_TAX_ENABLED=false`.
 *     Once they confirm:
 *       1. Update this constant if counsel chose differently.
 *       2. Flip STRIPE_TAX_ENABLED=true in prod env.
 *
 * See docs/2026-06-17/0736_financial-management-system-design.md §12.5.
 */
export const STRIPE_TAX_DEFAULT_TAX_CODE = 'txcd_10000000';

@Injectable()
export class StripeService {
  constructor(@Inject('STRIPE_CLIENT') private readonly stripe: Stripe) {}

  /**
   * Phase 8 (PR F8.1): is Stripe Tax enabled on new sessions/intents?
   * Gated by STRIPE_TAX_ENABLED env flag (default false). Code paths
   * conditionally set `automatic_tax: { enabled: true }`; without the
   * flag we ship dark and the flow is unchanged.
   */
  private get taxEnabled(): boolean {
    return process.env.STRIPE_TAX_ENABLED === 'true';
  }

  /**
   * Create Stripe customer
   */
  async createCustomer(params: {
    email: string;
    name: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    return this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: params.metadata || {},
    });
  }

  /**
   * Create subscription
   */
  async createSubscription(params: {
    customerId: string;
    priceId: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.create({
      customer: params.customerId,
      items: [{ price: params.priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: params.metadata || {},
    });
  }

  /**
   * Update subscription (change price or remove cancel_at_period_end)
   */
  async updateSubscription(
    subscriptionId: string,
    params: {
      priceId?: string;
      quantity?: number;
      cancelAtPeriodEnd?: boolean;
    },
  ): Promise<Stripe.Subscription> {
    const updateParams: Stripe.SubscriptionUpdateParams = {
      proration_behavior: 'create_prorations',
    };

    if (typeof params.cancelAtPeriodEnd === 'boolean') {
      updateParams.cancel_at_period_end = params.cancelAtPeriodEnd;
    }

    if (params.priceId) {
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      updateParams.items = [
        {
          id: subscription.items.data[0].id,
          price: params.priceId,
          quantity: params.quantity,
        },
      ];
    }

    return this.stripe.subscriptions.update(subscriptionId, updateParams);
  }

  /**
   * Attach a payment method to a customer and set as default
   */
  async attachPaymentMethod(
    paymentMethodId: string,
    customerId: string,
  ): Promise<void> {
    await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
    await this.stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    subscriptionId: string,
    immediately: boolean = false,
  ): Promise<Stripe.Subscription> {
    if (immediately) {
      return this.stripe.subscriptions.cancel(subscriptionId);
    } else {
      return this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    }
  }

  /**
   * Create checkout session (original method for subscriptions)
   */
  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    mode?: 'subscription' | 'payment';
  }): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.create({
      customer: params.customerId,
      mode: params.mode || 'subscription',
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      // Phase 8 (F8.1): conditional automatic_tax. Stripe Tax
      // requires the customer to have a billing address — for
      // subscription sessions, the Customer Portal collects it; for
      // payment sessions we set `customer_update.address: 'auto'`
      // so Stripe asks at checkout.
      ...(this.taxEnabled
        ? {
            automatic_tax: { enabled: true },
            customer_update: { address: 'auto' as const },
          }
        : {}),
    });
  }

  /**
   * Create flexible checkout session with full params
   * Used for credit purchases and auto top-up setup
   */
  async createFlexibleCheckoutSession(params: {
    mode: 'payment' | 'subscription' | 'setup';
    line_items?: Stripe.Checkout.SessionCreateParams.LineItem[];
    success_url: string;
    cancel_url: string;
    customer?: string;
    client_reference_id?: string;
    metadata?: Record<string, string>;
    payment_intent_data?: Stripe.Checkout.SessionCreateParams.PaymentIntentData;
    setup_intent_data?: Stripe.Checkout.SessionCreateParams.SetupIntentData;
  }): Promise<Stripe.Checkout.Session> {
    // Phase 8 (F8.1): conditional automatic_tax. Setup-mode sessions
    // don't take a charge, so tax is N/A for those.
    const taxFields: Record<string, unknown> =
      this.taxEnabled && params.mode !== 'setup'
        ? {
            automatic_tax: { enabled: true },
            customer_update: { address: 'auto' },
          }
        : {};
    return this.stripe.checkout.sessions.create({
      ...(params as any),
      ...taxFields,
    });
  }

  /**
   * Retrieve checkout session
   */
  async retrieveSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent', 'setup_intent', 'customer'],
    });
  }

  /**
   * Create billing portal session
   */
  async createBillingPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    return this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  /**
   * Record usage for metered billing
   */
  async recordUsage(
    subscriptionItemId: string,
    quantity: number,
    timestamp?: number,
  ): Promise<Stripe.UsageRecord> {
    return this.stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
      quantity,
      timestamp: timestamp || Math.floor(Date.now() / 1000),
      action: 'increment',
    });
  }

  /**
   * Get customer
   */
  async getCustomer(customerId: string): Promise<Stripe.Customer> {
    return this.stripe.customers.retrieve(
      customerId,
    ) as Promise<Stripe.Customer>;
  }

  /**
   * Get subscription
   */
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice', 'customer'],
    });
  }

  /**
   * List invoices for customer
   */
  async listInvoices(
    customerId: string,
    limit: number = 10,
  ): Promise<Stripe.Invoice[]> {
    const result = await this.stripe.invoices.list({
      customer: customerId,
      limit,
    });
    return result.data;
  }

  /**
   * Create a one-off Payment Intent.
   *
   * Used by:
   *   - Credit purchase: customer enters $X in the SPA; we create an
   *     intent for X*100 cents and return the client_secret. The SPA's
   *     Stripe Elements widget completes payment on the customer's
   *     device; payment_intent.succeeded webhook then refills credits.
   *   - Auto top-up: triggered server-side when the credit balance
   *     drops below the configured threshold. The customer's saved
   *     payment method is used without a confirmation modal (off-session).
   *
   * `metadata.purpose` distinguishes the two flows so the webhook
   * handler knows whether the credit refill is customer-initiated or
   * an auto-trigger.
   */
  async createPaymentIntent(params: {
    customerId: string;
    amountUsd: number;
    purpose: 'credit_purchase' | 'auto_topup';
    organizationId: string;
    paymentMethodId?: string;
    offSession?: boolean;
  }): Promise<Stripe.PaymentIntent> {
    const amountCents = Math.round(params.amountUsd * 100);
    return this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      customer: params.customerId,
      ...(params.paymentMethodId
        ? {
            payment_method: params.paymentMethodId,
            confirm: params.offSession === true,
            off_session: params.offSession === true,
          }
        : {
            automatic_payment_methods: { enabled: true },
          }),
      // Phase 8 (F8.1): automatic_tax on Payment Intents.
      //
      // CAVEAT: Stripe requires the Customer to have a billing or
      // shipping address on file. For Customer Portal subscribers
      // this is collected at sign-up; for credit-purchase users who
      // went through the legacy Payment Intent flow it may be missing.
      //
      // Pending tax-counsel sign-off, when STRIPE_TAX_ENABLED is
      // flipped on we also need to backfill addresses on existing
      // Customers (out of scope here; tracked separately).
      ...(this.taxEnabled ? { automatic_tax: { enabled: true } } : {}),
      metadata: {
        organizationId: params.organizationId,
        purpose: params.purpose,
        creditUsd: String(params.amountUsd),
      },
    });
  }

  /**
   * Create a refund against a payment intent. Phase 4 of the financial
   * management rollout (PR F4.1).
   *
   * Idempotency: the caller's `Idempotency-Key` is forwarded as
   * Stripe's request option of the same name. A retry with the same
   * key returns the same Stripe refund object (Stripe's 24h TTL on
   * keys lines up with our admin retry window).
   *
   * `amountMinorUnits` omitted = full refund of the remaining balance
   * on the intent.
   *
   * `expand: ['balance_transaction']` populates the canonical
   * reconciliation join key on the response object so the caller can
   * persist it without a second round-trip.
   */
  async createRefund(params: {
    paymentIntentId: string;
    amountMinorUnits?: number;
    reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<Stripe.Refund> {
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: params.paymentIntentId,
      ...(params.amountMinorUnits !== undefined
        ? { amount: params.amountMinorUnits }
        : {}),
      ...(params.reason ? { reason: params.reason } : {}),
      metadata: params.metadata ?? {},
      expand: ['balance_transaction'],
    };
    return this.stripe.refunds.create(refundParams, {
      idempotencyKey: params.idempotencyKey,
    });
  }

  async getRefund(refundId: string): Promise<Stripe.Refund> {
    return this.stripe.refunds.retrieve(refundId, {
      expand: ['balance_transaction'],
    });
  }

  async listRefunds(
    params: { paymentIntent?: string; charge?: string; limit?: number } = {},
  ): Promise<Stripe.Refund[]> {
    const out = await this.stripe.refunds.list({
      ...(params.paymentIntent ? { payment_intent: params.paymentIntent } : {}),
      ...(params.charge ? { charge: params.charge } : {}),
      limit: params.limit ?? 20,
      expand: ['data.balance_transaction'],
    });
    return out.data;
  }

  /**
   * The reconciliation backbone. Every cash-moving Stripe event
   * (charges, refunds, payouts, fees, disputes) is reified as a
   * BalanceTransaction with id=txn_*. Phase 6's reconciliation cron
   * pages through this listing daily.
   *
   * `created` filters by Unix timestamp range; `starting_after` paginates.
   */
  async listBalanceTransactions(params: {
    created?: { gte?: number; lt?: number };
    startingAfter?: string;
    limit?: number;
  } = {}): Promise<{ data: Stripe.BalanceTransaction[]; hasMore: boolean; lastId: string | null }> {
    const out = await this.stripe.balanceTransactions.list({
      ...(params.created ? { created: params.created } : {}),
      ...(params.startingAfter ? { starting_after: params.startingAfter } : {}),
      limit: params.limit ?? 100,
    });
    return {
      data: out.data,
      hasMore: out.has_more,
      lastId: out.data.length > 0 ? out.data[out.data.length - 1].id : null,
    };
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
    secret: string,
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }
}
