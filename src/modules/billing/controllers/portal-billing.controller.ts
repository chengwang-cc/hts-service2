import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { StripeService } from '../services/stripe.service';
import { SubscriptionService } from '../services/subscription.service';
import { PortalCheckoutDto } from '../dto/portal-checkout.dto';

interface CheckoutSessionResponse {
  url: string;
  sessionId: string;
}

/**
 * Portal-side Stripe checkout. Mounts under `/portal/billing/*` so the
 * route surface mirrors the rest of the JWT-gated portal endpoints
 * (`/portal/cost-alert`, `/portal/partner-usage`, etc.).
 *
 * Why a NEW endpoint instead of reusing `POST /billing/subscriptions/checkout`?
 *   1. The existing controller takes `organizationId` in the body and
 *      is mounted WITHOUT a JWT guard — fine for admin tooling but a
 *      cross-org footgun on the customer-facing portal. Here we derive
 *      the org from the JWT and reject anything else.
 *   2. The existing controller redirects through a backend hop
 *      (`/billing/subscriptions/checkout/success`) that lands on
 *      `/pricing`. The portal flow needs the user to land directly on
 *      `/business-portal/billing?status=success&plan=…` so they see
 *      their newly-active plan without bouncing through pricing.
 *
 * Both endpoints coexist; the legacy one stays for admin/back-office
 * scripts that already integrate with it.
 *
 * Plan -> Stripe price id is resolved by env var (production-managed,
 * test-mode by default in dev). If a price id is missing for the
 * requested plan we throw 500 rather than silently fall back, so a
 * misconfigured environment surfaces loudly in logs.
 */
@Controller('portal/billing')
@UseGuards(JwtAuthGuard)
export class PortalBillingController {
  private readonly logger = new Logger(PortalBillingController.name);

  /**
   * Stripe price IDs, env-first with the same test-mode defaults the
   * existing SubscriptionController uses. These defaults match the
   * test-mode Stripe account already wired via STRIPE_SECRET_KEY in
   * hts/app-secrets — so the endpoint works out of the box for e2e
   * + manual smoke without per-environment env var configuration.
   *
   * Production overrides via STRIPE_PRICE_* env vars when live-mode
   * pricing IDs need to be used (different prefix on live secret).
   */
  private readonly PRICE_IDS = {
    STARTER_MONTHLY: process.env.STRIPE_PRICE_STARTER_MONTHLY || 'price_1TFirqFlkGnRAYYW7oshC8t5',
    STARTER_YEARLY: process.env.STRIPE_PRICE_STARTER_YEARLY || 'price_1TFirqFlkGnRAYYWEbbIxnZ2',
    PROFESSIONAL_MONTHLY: process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY || 'price_1TFirrFlkGnRAYYWMQQG2B12',
    PROFESSIONAL_YEARLY: process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY || 'price_1TFirrFlkGnRAYYWAccaTxyT',
    ENTERPRISE_MONTHLY: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY || 'price_1TFirrFlkGnRAYYWki54ItkJ',
    ENTERPRISE_YEARLY: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY || 'price_1TFirrFlkGnRAYYWbHjg8a2i',
  } as const;

  constructor(
    private readonly stripeService: StripeService,
    private readonly subscriptionService: SubscriptionService,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
  ) {}

  /**
   * Create a Stripe Checkout session and return its URL. The SPA does a
   * top-level `window.location = url` redirect, the user completes
   * checkout on Stripe's domain, and Stripe redirects back to
   * `<SPA>/<portal>/billing?status=success&plan=…`. The webhook saves
   * the subscription independently (no backend success-handler hop).
   */
  @Post('checkout-session')
  @HttpCode(200)
  async createCheckoutSession(
    @CurrentUser() user: UserEntity,
    @Body() dto: PortalCheckoutDto,
  ): Promise<CheckoutSessionResponse> {
    const interval = dto.interval ?? 'month';
    const priceId = this.priceIdFor(dto.plan, interval);
    if (!priceId) {
      this.logger.error(
        `Stripe price id missing for plan=${dto.plan} interval=${interval} — check STRIPE_PRICE_* env`,
      );
      throw new InternalServerErrorException(
        `Plan ${dto.plan} (${interval}) is not configured for checkout`,
      );
    }

    const org = await this.orgs.findOne({ where: { id: user.organizationId } });
    if (!org) {
      throw new BadRequestException('Organization not found for current user');
    }

    // No-op upgrade: same plan + interval combo for an already-paid
    // org. Bouncing them through Stripe Checkout would create a second
    // subscription; we reject up front instead.
    if (org.plan === dto.plan) {
      throw new BadRequestException(
        `Organization is already on the ${dto.plan} plan`,
      );
    }

    const customerId = await this.subscriptionService.getOrCreateStripeCustomer({
      organizationId: org.id,
      email: user.email,
    });

    const portal = this.portalPathFor(org.type);
    const spaBase = process.env.SPA_BASE_URL ?? 'http://localhost:4200';

    const session = await this.stripeService.createFlexibleCheckoutSession({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${spaBase}${portal}/billing?status=success&plan=${dto.plan}&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${spaBase}${portal}/billing?status=cancel`,
      client_reference_id: org.id,
      metadata: {
        organizationId: org.id,
        plan: dto.plan,
        interval,
        initiatedBy: 'portal',
      },
    });

    if (!session.url) {
      // Stripe always returns a url on success — falling through to a
      // throw is defensive. If we ever see this in logs, Stripe's API
      // changed shape and the SDK type needs updating.
      throw new InternalServerErrorException('Stripe did not return a checkout URL');
    }

    return { url: session.url, sessionId: session.id };
  }

  private priceIdFor(
    plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE',
    interval: 'month' | 'year',
  ): string | undefined {
    const key =
      `${plan}_${interval === 'month' ? 'MONTHLY' : 'YEARLY'}` as keyof typeof this.PRICE_IDS;
    return this.PRICE_IDS[key];
  }

  /**
   * Which portal tree owns this org's billing UI. `partner` orgs land
   * on `/partner-portal/billing` after checkout; everyone else (the
   * `customer` default) lands on `/business-portal/billing`. `internal`
   * orgs use the same business portal — they don't typically upgrade
   * via Stripe but we don't 400 them either.
   */
  private portalPathFor(type: string): string {
    return type === 'partner' ? '/partner-portal' : '/business-portal';
  }
}
