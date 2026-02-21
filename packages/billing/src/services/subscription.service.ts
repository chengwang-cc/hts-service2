import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionEntity } from '../entities/subscription.entity';
import { InvoiceEntity } from '../entities/invoice.entity';
import { StripeService } from './stripe.service';

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

  async createSubscription(
    organizationId: string,
    planId: string,
    interval: 'month' | 'year',
    paymentMethodId?: string,
  ): Promise<{ clientSecret: string; subscriptionId: string }> {
    // This is a simplified version - in production you'd:
    // 1. Get or create Stripe customer
    // 2. Create Stripe subscription
    // 3. Save to database
    // For now, return placeholder
    return {
      clientSecret: 'placeholder_secret',
      subscriptionId: 'placeholder_sub_id',
    };
  }

  async changePlan(
    organizationId: string,
    newPlanId: string,
    interval?: 'month' | 'year',
  ): Promise<SubscriptionEntity> {
    const subscription = await this.getActiveSubscription(organizationId);
    if (!subscription) {
      throw new Error('No active subscription found');
    }

    subscription.plan = newPlanId;
    if (interval) {
      subscription.interval = interval;
    }

    return this.subscriptionRepo.save(subscription);
  }

  async cancelSubscription(
    organizationId: string,
    immediately: boolean = false,
  ): Promise<SubscriptionEntity> {
    const subscription = await this.getActiveSubscription(organizationId);
    if (!subscription) {
      throw new Error('No active subscription found');
    }

    if (immediately) {
      subscription.status = 'canceled';
    } else {
      subscription.cancelAtPeriodEnd = true;
    }

    return this.subscriptionRepo.save(subscription);
  }

  async reactivateSubscription(
    organizationId: string,
  ): Promise<SubscriptionEntity> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });

    if (!subscription) {
      throw new Error('No subscription found');
    }

    subscription.cancelAtPeriodEnd = false;
    subscription.status = 'active';

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
}
