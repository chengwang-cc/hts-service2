import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreditPurchaseEntity } from '../entities/credit-purchase.entity';
import { CreditBalanceEntity } from '../entities/credit-balance.entity';
import { StripeService } from './stripe.service';

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
    10: 5.00,
    20: 9.00,
    50: 20.00,
    100: 35.00,
    200: 60.00,
  };

  constructor(
    @InjectRepository(CreditPurchaseEntity)
    private readonly creditPurchaseRepo: Repository<CreditPurchaseEntity>,
    @InjectRepository(CreditBalanceEntity)
    private readonly creditBalanceRepo: Repository<CreditBalanceEntity>,
    private readonly stripeService: StripeService,
  ) {}

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
        `Invalid credit amount. Must be one of: ${Object.keys(this.CREDIT_PRICES).join(', ')}`
      );
    }

    this.logger.log(
      `Creating checkout session for ${dto.credits} credits ($${price}) for org ${dto.organizationId}`
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

    this.logger.log(`Created Stripe session ${session.id} for purchase ${purchase.id}`);

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
        `Purchase ${purchase.id} completed: ${purchase.credits} credits added to org ${purchase.organizationId}`
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
    purchase.metadata = { ...purchase.metadata, cancelledAt: new Date().toISOString() };
    await this.creditPurchaseRepo.save(purchase);

    return {
      success: false,
      returnUrl: `${purchase.returnUrl}?success=false&cancelled=true`,
    };
  }

  /**
   * Add credits to organization balance
   */
  private async addCredits(organizationId: string, credits: number): Promise<void> {
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
      `Added ${credits} credits to org ${organizationId}. New balance: ${balance.balance}`
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
   * Deduct credits from balance (used when API is called with credit mode)
   */
  async deductCredits(organizationId: string, amount: number = 1): Promise<boolean> {
    const balance = await this.creditBalanceRepo.findOne({
      where: { organizationId },
    });

    if (!balance || balance.balance < amount) {
      return false; // Insufficient credits
    }

    balance.balance -= amount;
    balance.lifetimeUsed += amount;
    balance.lastUsedAt = new Date();

    await this.creditBalanceRepo.save(balance);

    return true;
  }
}
