import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { BillingController } from './controllers/billing.controller';
import { CreditController } from './controllers/credit.controller';
import { SubscriptionController } from './controllers/subscription.controller';
import { CostAlertController } from './controllers/cost-alert.controller';
import { CostAlertAdminController } from './controllers/cost-alert.admin.controller';
import { SubscriptionEntity } from './entities/subscription.entity';
import { InvoiceEntity } from './entities/invoice.entity';
import { UsageRecordEntity } from './entities/usage-record.entity';
import { CreditPurchaseEntity } from './entities/credit-purchase.entity';
import { CreditBalanceEntity } from './entities/credit-balance.entity';
import { AutoTopUpConfigEntity } from './entities/auto-topup-config.entity';
import { CostAlertConfigEntity } from './entities/cost-alert-config.entity';
import { CostAlertEventEntity } from './entities/cost-alert-event.entity';
import { EntitlementService } from './services/entitlement.service';
import { StripeService } from './services/stripe.service';
import { SubscriptionService } from './services/subscription.service';
import { UsageTrackingService } from './services/usage-tracking.service';
import { CreditPurchaseService } from './services/credit-purchase.service';
import { BillingChargeService } from './services/billing-charge.service';
import { SubscriptionLimitsSyncService } from './services/subscription-limits-sync.service';
import { CostAlertService } from './services/cost-alert.service';
import { WebhookDeliveryService } from './services/webhook-delivery.service';
import { OrganizationEntity } from '../auth/entities/organization.entity';
import { PartnerUsageMonthlyEntity } from '../partner-attribution/entities/partner-usage-monthly.entity';
import { PartnerQuotaGuard } from './guards/partner-quota.guard';
import {
  createQuotaCacheProvider,
  QUOTA_CACHE,
} from './services/quota-cache.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      InvoiceEntity,
      UsageRecordEntity,
      CreditPurchaseEntity,
      CreditBalanceEntity,
      AutoTopUpConfigEntity,
      CostAlertConfigEntity,
      CostAlertEventEntity,
      OrganizationEntity,
      PartnerUsageMonthlyEntity,
    ]),
  ],
  providers: [
    {
      provide: 'STRIPE_CLIENT',
      useFactory: () => new Stripe(process.env.STRIPE_SECRET_KEY || '', {
        apiVersion: '2024-11-20.acacia' as any,
      }),
    },
    {
      provide: 'STRIPE_WEBHOOK_SECRET',
      useValue: process.env.STRIPE_WEBHOOK_SECRET || '',
    },
    EntitlementService,
    StripeService,
    SubscriptionService,
    UsageTrackingService,
    CreditPurchaseService,
    BillingChargeService,
    SubscriptionLimitsSyncService,
    createQuotaCacheProvider(),
    CostAlertService,
    WebhookDeliveryService,
    PartnerQuotaGuard,
  ],
  controllers: [
    BillingController,
    CreditController,
    SubscriptionController,
    CostAlertController,
    CostAlertAdminController,
  ],
  exports: [
    EntitlementService,
    StripeService,
    SubscriptionService,
    UsageTrackingService,
    CreditPurchaseService,
    BillingChargeService,
    SubscriptionLimitsSyncService,
    QUOTA_CACHE,
    CostAlertService,
    PartnerQuotaGuard,
  ],
})
export class BillingModule {}
