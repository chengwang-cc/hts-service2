import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  RawBody,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionService } from '../services/subscription.service';
import { UsageTrackingService } from '../services/usage-tracking.service';
import { EntitlementService } from '../services/entitlement.service';
import { StripeService } from '../services/stripe.service';
import { CreditPurchaseService } from '../services/credit-purchase.service';
import { BillingChargeService } from '../services/billing-charge.service';
import { SubscriptionLimitsSyncService } from '../services/subscription-limits-sync.service';
import { RefundService } from '../refunds/services/refund.service';
import { DisputeService } from '../disputes/services/dispute.service';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { PLANS } from '../config/plans.config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly usageService: UsageTrackingService,
    private readonly entitlementService: EntitlementService,
    private readonly stripeService: StripeService,
    private readonly creditPurchaseService: CreditPurchaseService,
    private readonly billingChargeService: BillingChargeService,
    private readonly limitsSync: SubscriptionLimitsSyncService,
    private readonly refundService: RefundService,
    private readonly disputeService: DisputeService,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    @Inject('STRIPE_WEBHOOK_SECRET') private readonly webhookSecret: string,
  ) {}

  /**
   * Get credit balance + pricing summary for the caller's organization.
   * Used by the website dashboard widget + the Shopify embedded admin
   * Overview tab.
   *
   * Returns:
   *   balance, lifetimePurchased, lifetimeUsed, lastUsedAt, lastPurchaseAt,
   *   pricing.perCallCredits, pricing.perCreditCents,
   *   billingEnabled (false = shadow mode, true = real deductions)
   */
  @Get('credits')
  async getCreditSummary(@CurrentUser() user: any) {
    const orgId = user.organizationId;
    const row = await this.creditPurchaseService.getBalanceRow(orgId);
    return {
      balance: row?.balance ?? 0,
      lifetimePurchased: row?.lifetimePurchased ?? 0,
      lifetimeUsed: row?.lifetimeUsed ?? 0,
      lastUsedAt: row?.lastUsedAt ?? null,
      lastPurchaseAt: row?.lastPurchaseAt ?? null,
      pricing: {
        perCallCredits: this.billingChargeService.perCallCredits(),
        perCreditCents: this.billingChargeService.perCreditCents(),
      },
      billingEnabled: this.billingChargeService.isBillingEnabled(),
    };
  }

  /**
   * Get current subscription
   */
  @Get('subscription')
  async getCurrentSubscription(@CurrentUser() user: any) {
    const subscription = await this.subscriptionService.getActiveSubscription(
      user.organizationId,
    );

    if (!subscription) {
      // Return default FREE plan if no subscription exists
      return {
        plan: 'FREE',
        status: 'active',
        organizationId: user.organizationId,
      };
    }

    return subscription;
  }

  /**
   * Create new subscription
   */
  @Post('subscription')
  async createSubscription(
    @CurrentUser() user: any,
    @Body()
    body: {
      planId: string;
      interval: 'month' | 'year';
      paymentMethodId?: string;
    },
  ) {
    // Check if subscription already exists
    const existing = await this.subscriptionService.getActiveSubscription(
      user.organizationId,
    );

    if (existing && existing.status === 'active') {
      throw new HttpException(
        'Active subscription already exists. Use PATCH to update.',
        HttpStatus.CONFLICT,
      );
    }

    return this.subscriptionService.createSubscription(
      user.organizationId,
      body.planId,
      body.interval,
      body.paymentMethodId,
    );
  }

  /**
   * Update subscription (change plan or interval)
   */
  @Patch('subscription')
  async updateSubscription(
    @CurrentUser() user: any,
    @Body() body: { planId?: string; interval?: 'month' | 'year' },
  ) {
    const subscription = await this.subscriptionService.getActiveSubscription(
      user.organizationId,
    );

    if (!subscription) {
      throw new HttpException(
        'No active subscription found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (body.planId) {
      return this.subscriptionService.changePlan(
        user.organizationId,
        body.planId,
        body.interval,
      );
    }

    throw new HttpException('planId is required', HttpStatus.BAD_REQUEST);
  }

  /**
   * Cancel subscription
   */
  @Delete('subscription')
  async cancelSubscription(
    @CurrentUser() user: any,
    @Query('immediately') immediately?: string,
  ) {
    return this.subscriptionService.cancelSubscription(
      user.organizationId,
      immediately === 'true',
    );
  }

  /**
   * Reactivate canceled subscription
   */
  @Post('subscription/reactivate')
  async reactivateSubscription(@CurrentUser() user: any) {
    return this.subscriptionService.reactivateSubscription(user.organizationId);
  }

  /**
   * Get usage summary for current billing period
   */
  @Get('usage')
  async getUsageSummary(
    @CurrentUser() user: any,
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    const subscription = await this.subscriptionService.getActiveSubscription(
      user.organizationId,
    );
    const plan = subscription?.plan || 'FREE';

    // Get current usage
    const start = periodStart
      ? new Date(periodStart)
      : subscription?.currentPeriodStart || new Date();
    const end = periodEnd
      ? new Date(periodEnd)
      : subscription?.currentPeriodEnd || new Date();

    const usage = await this.usageService.getUsageSummary(
      user.organizationId,
      start,
      end,
    );

    // Calculate overages
    const overageData = await this.entitlementService.calculateOverages(
      plan,
      usage,
    );

    return {
      period: { start, end },
      usage: this.formatUsageForResponse(plan, usage),
      overages: overageData.overages,
      totalOverageCost: overageData.totalCharge,
    };
  }

  /**
   * Get usage records
   */
  @Get('usage/records')
  async getUsageRecords(
    @CurrentUser() user: any,
    @Query('feature') feature?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usageService.getUsageRecords(
      user.organizationId,
      feature,
      limit ? parseInt(limit) : 100,
    );
  }

  /**
   * Track usage (for API/widget usage)
   */
  @Post('usage/track')
  async trackUsage(
    @CurrentUser() user: any,
    @Body()
    body: {
      feature: string;
      quantity?: number;
      metadata?: Record<string, any>;
    },
  ) {
    await this.usageService.trackUsage(
      user.organizationId,
      body.feature,
      body.quantity || 1,
      body.metadata,
    );

    return { success: true };
  }

  /**
   * Check entitlement for a feature
   */
  @Get('entitlement/check')
  async checkEntitlement(
    @CurrentUser() user: any,
    @Query('feature') feature: string,
  ) {
    if (!feature) {
      throw new HttpException('feature is required', HttpStatus.BAD_REQUEST);
    }

    const subscription = await this.subscriptionService.getActiveSubscription(
      user.organizationId,
    );
    const plan = subscription?.plan || 'FREE';

    const usage = await this.usageService.getCurrentUsage(user.organizationId);

    return this.entitlementService.checkEntitlement(plan, usage, feature);
  }

  /**
   * Get all available plans
   */
  @Get('plans')
  async listPlans() {
    return Object.values(PLANS).map((plan) => ({
      id: plan.id,
      name: plan.name || plan.id,
      description: plan.description || '',
      price: plan.price,
      features: plan.features,
      popular: plan.id === 'PROFESSIONAL',
    }));
  }

  /**
   * List invoices
   */
  @Get('invoices')
  async listInvoices(@CurrentUser() user: any) {
    return this.subscriptionService.getInvoices(user.organizationId);
  }

  /**
   * Get specific invoice
   */
  @Get('invoices/:invoiceId')
  async getInvoice(
    @CurrentUser() user: any,
    @Param('invoiceId') invoiceId: string,
  ) {
    const invoice = await this.subscriptionService.getInvoice(
      user.organizationId,
      invoiceId,
    );

    if (!invoice) {
      throw new HttpException('Invoice not found', HttpStatus.NOT_FOUND);
    }

    return invoice;
  }

  /**
   * Stripe webhook handler — public route, verified by Stripe signature
   */
  @Post('webhook')
  @Public()
  async handleWebhook(
    @RawBody() rawBody: Buffer,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!this.webhookSecret) {
      this.logger.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
    }

    let event: import('stripe').default.Event;
    try {
      event = this.stripeService.verifyWebhookSignature(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err}`);
      throw new HttpException('Invalid webhook signature', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`Stripe webhook: ${event.type}`);

    try {
      await this.processWebhookEvent(event);
    } catch (err) {
      this.logger.error(`Error processing webhook ${event.type}: ${err}`);
      // Return 200 so Stripe doesn't retry; we log for manual recovery
    }

    return { received: true };
  }

  private async processWebhookEvent(event: import('stripe').default.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as import('stripe').default.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription && session.client_reference_id) {
          const organizationId = session.client_reference_id;
          const plan = (session.metadata?.plan as string) ?? 'STARTER';
          const interval = (session.metadata?.interval as 'month' | 'year') ?? 'month';
          await this.subscriptionService.saveSubscriptionFromCheckout({
            organizationId,
            planId: plan,
            interval,
            stripeSubscriptionId: session.subscription as string,
            stripeCustomerId: session.customer as string,
          });
          // Phase 2: also mutate the org row so the SPA + quota guard see
          // the new plan. The subscription row is the source of truth for
          // billing; `org.plan` mirrors it for everything else (dashboard
          // label, effective limits, partner attribution joins).
          await this.applyPlanToOrganization(organizationId, plan);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as import('stripe').default.Subscription;
        const organizationId = sub.metadata?.organizationId;
        const planId = sub.metadata?.planId;
        const interval = (sub.metadata?.interval as 'month' | 'year') ?? 'month';
        if (organizationId && planId) {
          await this.subscriptionService.upsertSubscriptionFromStripe(
            organizationId,
            planId,
            interval,
            sub,
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as import('stripe').default.Subscription;
        const organizationId = sub.metadata?.organizationId;
        const planId = sub.metadata?.planId ?? 'STARTER';
        const interval = (sub.metadata?.interval as 'month' | 'year') ?? 'month';
        if (organizationId) {
          await this.subscriptionService.upsertSubscriptionFromStripe(
            organizationId,
            planId,
            interval,
            sub,
          );
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as import('stripe').default.Invoice;
        const organizationId = invoice.subscription_details?.metadata?.organizationId
          ?? (invoice.metadata?.organizationId);
        if (organizationId) {
          await this.subscriptionService.saveInvoiceFromStripe(organizationId, invoice);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as import('stripe').default.Invoice;
        const organizationId = invoice.subscription_details?.metadata?.organizationId
          ?? (invoice.metadata?.organizationId);
        if (organizationId) {
          await this.subscriptionService.saveInvoiceFromStripe(organizationId, invoice);
          this.logger.warn(`Payment failed for org ${organizationId}: invoice ${invoice.id}`);
        }
        break;
      }

      case 'payment_intent.succeeded': {
        // Phase 4a: one-off credit purchase + auto top-up.
        // The intent's metadata is set by us at creation
        // (StripeService.createPaymentIntent), so we trust it. The
        // CreditPurchaseService entry point is idempotent (matches on
        // stripe_payment_intent_id) so duplicate webhook delivery is
        // a no-op.
        const intent = event.data.object as import('stripe').default.PaymentIntent;
        const purpose = intent.metadata?.purpose;
        const organizationId = intent.metadata?.organizationId;
        const creditsRaw = intent.metadata?.creditUsd;
        if (
          (purpose === 'credit_purchase' || purpose === 'auto_topup') &&
          organizationId &&
          creditsRaw
        ) {
          // We persisted the tier's `credits` value into the pending
          // purchase row at intent-creation time; the webhook re-derives
          // it from the amount. Defensive: if the amounts disagree, the
          // service treats the purchase row as the truth.
          const amountUsd = (intent.amount ?? 0) / 100;
          await this.creditPurchaseService.creditFromPaymentIntent({
            paymentIntentId: intent.id,
            organizationId,
            credits: this.creditsForUsd(amountUsd),
          });
        }
        break;
      }

      // ── Refund webhooks (Phase 4, PR F4.1) ─────────────────────────
      // The `refund.*` family is the modern Stripe surface; we listen
      // to all three plus the legacy charge.refunded. The string-comparison
      // detour vs. `case` literals is because the Stripe SDK's union
      // type at this version doesn't include 'refund.failed' yet —
      // the event IS sent by Stripe, just not typed.

      case 'charge.refunded': {
        // Legacy event — log only. The refund.* family handles state.
        this.logger.debug(`charge.refunded received (legacy compat): ${event.id}`);
        break;
      }

      // ── Dispute webhooks (Phase 5, PR F5.1) ────────────────────────
      // Stripe's chargeback family. All five route to DisputeService;
      // it handles ordering + idempotency internally.
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
      case 'charge.dispute.funds_withdrawn':
      case 'charge.dispute.funds_reinstated': {
        await this.disputeService.onDisputeEvent(event);
        break;
      }

      default:
        if (
          event.type === 'refund.created' ||
          event.type === 'refund.updated' ||
          (event.type as string) === 'refund.failed'
        ) {
          await this.refundService.onRefundEvent(event);
          break;
        }
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  }

  /**
   * Applied from the `checkout.session.completed` webhook. Three things
   * happen here so the rest of the system reflects the new plan:
   *
   *   1. `org.plan` flips to the new plan label — used by the SPA
   *      dashboard, partner-portal sidebar, and the JWT-time auth lookup.
   *   2. `org.settings.firstPaidAt` is stamped on the FIRST upgrade —
   *      drives lifetime-free-vs-upgraded dashboards. Subsequent
   *      upgrades (e.g. STARTER → PROFESSIONAL) don't churn it.
   *   3. `SubscriptionLimitsSyncService` recomputes effective limits
   *      from the new plan and writes them to `org.settings.effectiveLimits`.
   *      Quota guard reads these to enforce the new per-month cap.
   *
   * The whole thing is best-effort: a failure here logs but does NOT
   * fail the webhook response (Stripe would retry, doubling work).
   * If the org row is missing or the plan is unknown, we log + move on.
   */
  private async applyPlanToOrganization(
    organizationId: string,
    plan: string,
  ): Promise<void> {
    try {
      const org = await this.orgs.findOne({ where: { id: organizationId } });
      if (!org) {
        this.logger.warn(
          `applyPlanToOrganization: org ${organizationId} not found — skipping`,
        );
        return;
      }

      const settings: Record<string, any> = { ...(org.settings ?? {}) };
      if (!settings.firstPaidAt) {
        settings.firstPaidAt = new Date().toISOString();
      }

      await this.orgs.update(
        { id: organizationId },
        { plan, settings },
      );

      // Effective limits sync — independent so a sync failure (unknown
      // plan id) doesn't roll back the org.plan flip. The quota guard
      // tolerates missing effectiveLimits by falling back to FREE
      // defaults.
      try {
        await this.limitsSync.syncFromPlan(organizationId);
      } catch (err) {
        this.logger.warn(
          `applyPlanToOrganization: syncFromPlan failed for ${organizationId}: ${(err as Error)?.message}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `applyPlanToOrganization: failed for ${organizationId}: ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Reverse-lookup the credit tier for a USD amount. Used by the
   * payment_intent.succeeded webhook because the intent carries the
   * dollar amount; we want the credits to refill the balance.
   * Returns 0 (no-op) if the amount doesn't match any known tier —
   * keeps the webhook safe from off-tier purchases (which can only
   * arise from someone hand-crafting an intent in the Stripe dashboard).
   */
  private creditsForUsd(amountUsd: number): number {
    const map: Record<string, number> = {
      '5': 10,
      '9': 20,
      '20': 50,
      '35': 100,
      '60': 200,
    };
    return map[String(amountUsd)] ?? 0;
  }

  /**
   * Format usage data for API response
   */
  private formatUsageForResponse(plan: string, usage: Record<string, number>) {
    const planConfig = PLANS[plan];
    if (!planConfig) return {};

    const formatted: Record<string, any> = {};

    // Iterate through usage and add quota information
    Object.entries(usage).forEach(([feature, current]) => {
      const [category, featureKey] = feature.split('.');
      const quota = planConfig.features[category]?.[featureKey];

      formatted[feature] = {
        current,
        quota: typeof quota === 'number' ? quota : null,
        percentage:
          typeof quota === 'number' && quota > 0
            ? Math.round((current / quota) * 100)
            : 0,
      };
    });

    return formatted;
  }
}
