import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  SubscriptionService,
  UsageTrackingService,
  EntitlementService,
  PLANS,
} from '@hts/billing';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly usageService: UsageTrackingService,
    private readonly entitlementService: EntitlementService,
  ) {}

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
   * Stripe webhook handler
   */
  @Post('webhook')
  async handleWebhook(@Body() body: any) {
    // This should validate the webhook signature
    // For now, just acknowledge receipt
    return { received: true };
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
