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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionEntity } from '../entities/subscription.entity';

export interface CreateSubscriptionCheckoutDto {
  organizationId: string;
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  interval?: 'month' | 'year';
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
  // Stripe Price IDs - In production, these should come from environment variables or database
  private readonly PRICE_IDS = {
    STARTER_MONTHLY: 'price_starter_monthly_placeholder',
    STARTER_YEARLY: 'price_starter_yearly_placeholder',
    PROFESSIONAL_MONTHLY: 'price_professional_monthly_placeholder',
    PROFESSIONAL_YEARLY: 'price_professional_yearly_placeholder',
  };

  constructor(
    private readonly stripeService: StripeService,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo: Repository<SubscriptionEntity>,
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

    // Get the appropriate price ID
    const priceId = this.getPriceId(dto.plan, interval);

    if (!priceId) {
      throw new BadRequestException('Invalid plan or interval');
    }

    // Create pending subscription record
    const subscription = this.subscriptionRepo.create({
      organizationId: dto.organizationId,
      plan: dto.plan,
      interval,
      status: 'pending',
    });
    await this.subscriptionRepo.save(subscription);

    // Create Stripe checkout session
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3100';
    const session = await this.stripeService.createFlexibleCheckoutSession({
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/api/v1/billing/subscriptions/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/api/v1/billing/subscriptions/checkout/cancel?session_id={CHECKOUT_SESSION_ID}`,
      client_reference_id: subscription.id,
      metadata: {
        organizationId: dto.organizationId,
        plan: dto.plan,
        interval,
      },
    });

    // Update subscription with Stripe session ID
    subscription.stripeSubscriptionId = session.id;
    await this.subscriptionRepo.save(subscription);

    return {
      sessionId: session.id,
      checkoutUrl: session.url!,
    };
  }

  /**
   * Handle successful payment
   * GET /api/v1/billing/subscriptions/checkout/success?session_id=xxx
   */
  @Get('checkout/success')
  async handleSuccess(
    @Query('session_id') sessionId: string,
    @Res() res: Response,
  ) {
    if (!sessionId) {
      throw new BadRequestException('Missing session_id');
    }

    // Retrieve session from Stripe
    const session = await this.stripeService.retrieveSession(sessionId);

    // Find subscription by client_reference_id
    const subscription = await this.subscriptionRepo.findOne({
      where: { id: session.client_reference_id as string },
    });

    if (!subscription) {
      throw new BadRequestException('Subscription not found');
    }

    // Update subscription status
    subscription.status = 'active';
    subscription.stripeSubscriptionId = session.subscription as string;
    await this.subscriptionRepo.save(subscription);

    // Build return URL
    const returnUrl = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/pricing?payment=success&plan=${subscription.plan}`;

    return res.redirect(returnUrl);
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
    if (!sessionId) {
      throw new BadRequestException('Missing session_id');
    }

    // Retrieve session from Stripe
    const session = await this.stripeService.retrieveSession(sessionId);

    // Find and update subscription
    const subscription = await this.subscriptionRepo.findOne({
      where: { id: session.client_reference_id as string },
    });

    if (subscription) {
      subscription.status = 'cancelled';
      await this.subscriptionRepo.save(subscription);
    }

    // Build return URL
    const returnUrl = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/pricing?payment=cancelled`;

    return res.redirect(returnUrl);
  }

  /**
   * Get Stripe price ID based on plan and interval
   */
  private getPriceId(plan: string, interval: 'month' | 'year'): string | null {
    const key =
      `${plan}_${interval === 'month' ? 'MONTHLY' : 'YEARLY'}` as keyof typeof this.PRICE_IDS;
    return this.PRICE_IDS[key] || null;
  }
}
