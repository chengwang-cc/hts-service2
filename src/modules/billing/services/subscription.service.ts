import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionEntity } from '../entities/subscription.entity';
import { InvoiceEntity } from '../entities/invoice.entity';
import { StripeService } from './stripe.service';
import { PLANS } from '../config/plans.config';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo: Repository<SubscriptionEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepo: Repository<InvoiceEntity>,
    private readonly stripeService: StripeService,
  ) {}

  async getActiveSubscription(
    organizationId: string,
  ): Promise<SubscriptionEntity | null> {
    return this.subscriptionRepo.findOne({
      where: { organizationId, status: 'active' },
      order: { createdAt: 'DESC' },
    });
  }

  async getOrCreateStripeCustomer(params: {
    organizationId: string;
    email: string;
    name?: string;
  }): Promise<string> {
    // Check if any existing subscription has a customer ID
    const existing = await this.subscriptionRepo.findOne({
      where: { organizationId: params.organizationId },
      order: { createdAt: 'DESC' },
    });
    if (existing?.stripeCustomerId) {
      return existing.stripeCustomerId;
    }

    const customer = await this.stripeService.createCustomer({
      email: params.email,
      name: params.name || params.email,
      metadata: { organizationId: params.organizationId },
    });
    return customer.id;
  }

  async createSubscription(
    organizationId: string,
    planId: string,
    interval: 'month' | 'year',
    paymentMethodId?: string,
  ): Promise<{ clientSecret: string; subscriptionId: string }> {
    const plan = PLANS[planId];
    if (!plan) throw new Error(`Unknown plan: ${planId}`);

    const priceId =
      interval === 'month' ? plan.stripePriceIds.monthly : plan.stripePriceIds.yearly;
    if (!priceId) throw new Error(`No price configured for plan ${planId}/${interval}`);

    if (!paymentMethodId) {
      throw new Error('paymentMethodId is required for direct subscription creation. Use checkout session flow instead.');
    }

    // Get or create Stripe customer
    const existing = await this.subscriptionRepo.findOne({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
    if (!existing?.stripeCustomerId) {
      throw new Error('No Stripe customer found. Create a checkout session first.');
    }
    const customerId = existing.stripeCustomerId;

    // Attach payment method and set as default
    await this.stripeService.attachPaymentMethod(paymentMethodId, customerId);

    const stripeSub = await this.stripeService.createSubscription({
      customerId,
      priceId,
      metadata: { organizationId, planId, interval },
    });

    const invoice = stripeSub.latest_invoice as import('stripe').default.Invoice;
    const paymentIntent = invoice?.payment_intent as import('stripe').default.PaymentIntent;
    const clientSecret = paymentIntent?.client_secret ?? '';

    await this.upsertSubscriptionFromStripe(organizationId, planId, interval, stripeSub);

    return {
      clientSecret,
      subscriptionId: stripeSub.id,
    };
  }

  async upsertSubscriptionFromStripe(
    organizationId: string,
    planId: string,
    interval: 'month' | 'year',
    stripeSub: import('stripe').default.Subscription,
  ): Promise<SubscriptionEntity> {
    const plan = PLANS[planId];
    const priceAmount = interval === 'month' ? plan?.price.monthly : plan?.price.yearly;

    let subscription = await this.subscriptionRepo.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });

    if (!subscription) {
      subscription = this.subscriptionRepo.create({ organizationId });
    }

    subscription.stripeSubscriptionId = stripeSub.id;
    subscription.stripeCustomerId = stripeSub.customer as string;
    subscription.plan = planId;
    subscription.interval = interval;
    subscription.status = stripeSub.status;
    subscription.amount = priceAmount ?? 0;
    subscription.currency = 'USD';
    subscription.currentPeriodStart = stripeSub.current_period_start
      ? new Date(stripeSub.current_period_start * 1000)
      : null;
    subscription.currentPeriodEnd = stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000)
      : null;
    subscription.cancelAtPeriodEnd = stripeSub.cancel_at_period_end;
    subscription.cancelAt = stripeSub.cancel_at
      ? new Date(stripeSub.cancel_at * 1000)
      : null;

    return this.subscriptionRepo.save(subscription);
  }

  async changePlan(
    organizationId: string,
    newPlanId: string,
    interval?: 'month' | 'year',
  ): Promise<SubscriptionEntity> {
    const subscription = await this.getActiveSubscription(organizationId);
    if (!subscription) throw new Error('No active subscription found');

    const plan = PLANS[newPlanId];
    if (!plan) throw new Error(`Unknown plan: ${newPlanId}`);

    const newInterval = interval ?? subscription.interval;
    const priceId =
      newInterval === 'month' ? plan.stripePriceIds.monthly : plan.stripePriceIds.yearly;
    if (!priceId) throw new Error(`No price configured for plan ${newPlanId}/${newInterval}`);

    await this.stripeService.updateSubscription(subscription.stripeSubscriptionId, {
      priceId,
    });

    subscription.plan = newPlanId;
    subscription.interval = newInterval;
    subscription.amount =
      newInterval === 'month' ? plan.price.monthly : plan.price.yearly;

    return this.subscriptionRepo.save(subscription);
  }

  async cancelSubscription(
    organizationId: string,
    immediately = false,
  ): Promise<SubscriptionEntity> {
    const subscription = await this.getActiveSubscription(organizationId);
    if (!subscription) throw new Error('No active subscription found');

    await this.stripeService.cancelSubscription(
      subscription.stripeSubscriptionId,
      immediately,
    );

    if (immediately) {
      subscription.status = 'canceled';
    } else {
      subscription.cancelAtPeriodEnd = true;
    }

    return this.subscriptionRepo.save(subscription);
  }

  async reactivateSubscription(organizationId: string): Promise<SubscriptionEntity> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
    if (!subscription) throw new Error('No subscription found');

    // Remove cancel_at_period_end on Stripe
    await this.stripeService.updateSubscription(subscription.stripeSubscriptionId, {
      cancelAtPeriodEnd: false,
    });

    subscription.cancelAtPeriodEnd = false;
    subscription.status = 'active';

    return this.subscriptionRepo.save(subscription);
  }

  async saveSubscriptionFromCheckout(params: {
    organizationId: string;
    planId: string;
    interval: 'month' | 'year';
    stripeSubscriptionId: string;
    stripeCustomerId: string;
  }): Promise<SubscriptionEntity> {
    const plan = PLANS[params.planId];

    let subscription = await this.subscriptionRepo.findOne({
      where: { organizationId: params.organizationId },
      order: { createdAt: 'DESC' },
    });

    if (!subscription) {
      subscription = this.subscriptionRepo.create({
        organizationId: params.organizationId,
      });
    }

    // Fetch real subscription details from Stripe
    const stripeSub = await this.stripeService.getSubscription(
      params.stripeSubscriptionId,
    );

    subscription.stripeSubscriptionId = stripeSub.id;
    subscription.stripeCustomerId = params.stripeCustomerId;
    subscription.plan = params.planId;
    subscription.interval = params.interval;
    subscription.status = 'active';
    subscription.amount =
      params.interval === 'month' ? plan?.price.monthly ?? 0 : plan?.price.yearly ?? 0;
    subscription.currency = 'USD';
    subscription.currentPeriodStart = stripeSub.current_period_start
      ? new Date(stripeSub.current_period_start * 1000)
      : null;
    subscription.currentPeriodEnd = stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000)
      : null;
    subscription.cancelAtPeriodEnd = false;
    subscription.cancelAt = null;

    return this.subscriptionRepo.save(subscription);
  }

  async getInvoices(organizationId: string): Promise<InvoiceEntity[]> {
    return this.invoiceRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async getInvoice(
    organizationId: string,
    invoiceId: string,
  ): Promise<InvoiceEntity | null> {
    return this.invoiceRepo.findOne({
      where: { id: invoiceId, organizationId },
    });
  }

  async saveInvoiceFromStripe(
    organizationId: string,
    stripeInvoice: import('stripe').default.Invoice,
  ): Promise<InvoiceEntity> {
    let invoice = await this.invoiceRepo.findOne({
      where: { stripeInvoiceId: stripeInvoice.id },
    });

    if (!invoice) {
      invoice = this.invoiceRepo.create({ organizationId });
    }

    const now = new Date();
    invoice.stripeInvoiceId = stripeInvoice.id;
    invoice.stripeCustomerId = stripeInvoice.customer as string;
    invoice.status = stripeInvoice.status ?? 'draft';
    invoice.subtotal = stripeInvoice.subtotal / 100;
    invoice.tax = (stripeInvoice.tax ?? 0) / 100;
    invoice.total = stripeInvoice.total / 100;
    invoice.currency = stripeInvoice.currency?.toUpperCase() ?? 'USD';
    invoice.periodStart = stripeInvoice.period_start
      ? new Date(stripeInvoice.period_start * 1000)
      : now;
    invoice.periodEnd = stripeInvoice.period_end
      ? new Date(stripeInvoice.period_end * 1000)
      : now;
    invoice.dueDate = stripeInvoice.due_date
      ? new Date(stripeInvoice.due_date * 1000)
      : null;
    invoice.paidAt = stripeInvoice.status === 'paid' && stripeInvoice.status_transitions?.paid_at
      ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
      : null;
    invoice.hostedInvoiceUrl = stripeInvoice.hosted_invoice_url ?? null;
    invoice.invoicePdf = stripeInvoice.invoice_pdf ?? null;

    // Phase 7 (F7.1): canonical money columns in integer minor units.
    // Phase 8 (F8.1): tax_amount_minor_units populated from Stripe's
    // `tax` field when automatic_tax is on; falls through to NULL
    // for legacy invoices without tax.
    invoice.amountMinorUnits = String(stripeInvoice.total);
    invoice.taxAmountMinorUnits =
      stripeInvoice.tax != null ? String(stripeInvoice.tax) : null;
    // stripe_balance_transaction_id: Stripe ties paid invoices to
    // exactly one balance_transaction via the underlying charge. We
    // don't fetch the charge here to avoid an extra API round-trip
    // — the reconciliation cron joins by other keys.

    return this.invoiceRepo.save(invoice);
  }
}
