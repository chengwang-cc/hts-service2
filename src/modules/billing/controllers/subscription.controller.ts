import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { StripeService } from '../services/stripe.service';
import { SubscriptionService } from '../services/subscription.service';

export interface CreateSubscriptionCheckoutDto {
  organizationId: string;
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  interval?: 'month' | 'year';
  email?: string;
  returnUrl: string;
}

interface CheckoutSessionResponse {
  sessionId: string;
  checkoutUrl: string;
}

/**
 * Subscription Controller
 * Handles subscription checkout flow using Stripe Checkout Sessions
 */
@Controller('billing/subscriptions')
export class SubscriptionController {
  private readonly PRICE_IDS = {
    STARTER_MONTHLY: process.env.STRIPE_PRICE_STARTER_MONTHLY || 'price_1TFirqFlkGnRAYYW7oshC8t5',
    STARTER_YEARLY: process.env.STRIPE_PRICE_STARTER_YEARLY || 'price_1TFirqFlkGnRAYYWEbbIxnZ2',
    PROFESSIONAL_MONTHLY: process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY || 'price_1TFirrFlkGnRAYYWMQQG2B12',
    PROFESSIONAL_YEARLY: process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY || 'price_1TFirrFlkGnRAYYWAccaTxyT',
    ENTERPRISE_MONTHLY: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY || 'price_1TFirrFlkGnRAYYWki54ItkJ',
    ENTERPRISE_YEARLY: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY || 'price_1TFirrFlkGnRAYYWbHjg8a2i',
  };

  constructor(
    private readonly stripeService: StripeService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /**
   * Create Stripe Checkout Session for subscription
   * POST /api/v1/billing/subscriptions/checkout
   */
  @Post('checkout')
  async createCheckoutSession(
    @Body() dto: CreateSubscriptionCheckoutDto,
  ): Promise<CheckoutSessionResponse> {
    const interval = dto.interval || 'month';
    const priceId = this.getPriceId(dto.plan, interval);

    if (!priceId) {
      throw new BadRequestException('Invalid plan or interval');
    }

    // Get or create Stripe customer if email is provided
    let customerId: string | undefined;
    if (dto.email) {
      customerId = await this.subscriptionService.getOrCreateStripeCustomer({
        organizationId: dto.organizationId,
        email: dto.email,
      });
    }

    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3100';
    const session = await this.stripeService.createFlexibleCheckoutSession({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/api/v1/billing/subscriptions/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/api/v1/billing/subscriptions/checkout/cancel?session_id={CHECKOUT_SESSION_ID}`,
      client_reference_id: dto.organizationId,
      metadata: {
        organizationId: dto.organizationId,
        plan: dto.plan,
        interval,
      },
    });

    return {
      sessionId: session.id,
      checkoutUrl: session.url!,
    };
  }

  /**
   * Handle successful payment — redirect back to frontend
   * GET /api/v1/billing/subscriptions/checkout/success?session_id=xxx
   */
  @Get('checkout/success')
  async handleSuccess(
    @Query('session_id') sessionId: string,
    @Res() res: Response,
  ) {
    if (!sessionId) throw new BadRequestException('Missing session_id');

    const session = await this.stripeService.retrieveSession(sessionId);
    const organizationId = session.client_reference_id;
    const plan = (session.metadata?.plan as 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE') ?? 'STARTER';
    const interval = (session.metadata?.interval as 'month' | 'year') ?? 'month';

    if (organizationId && session.subscription) {
      await this.subscriptionService.saveSubscriptionFromCheckout({
        organizationId,
        planId: plan,
        interval,
        stripeSubscriptionId: session.subscription as string,
        stripeCustomerId: session.customer as string,
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    return res.redirect(`${frontendUrl}/pricing?payment=success&plan=${plan}`);
  }

  /**
   * Handle cancelled payment
   * GET /api/v1/billing/subscriptions/checkout/cancel?session_id=xxx
   */
  @Get('checkout/cancel')
  async handleCancel(
    @Query('session_id') sessionId: string,
    @Res() res: Response,
  ) {
    if (!sessionId) throw new BadRequestException('Missing session_id');

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    return res.redirect(`${frontendUrl}/pricing?payment=cancelled`);
  }

  private getPriceId(plan: string, interval: 'month' | 'year'): string | null {
    const key =
      `${plan}_${interval === 'month' ? 'MONTHLY' : 'YEARLY'}` as keyof typeof this.PRICE_IDS;
    return this.PRICE_IDS[key] || null;
  }
}
