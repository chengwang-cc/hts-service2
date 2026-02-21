import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingPackageModule,
  SubscriptionEntity,
  InvoiceEntity,
  UsageRecordEntity,
  CreditPurchaseEntity,
  CreditBalanceEntity,
  AutoTopUpConfigEntity,
  EntitlementService,
  StripeService,
  SubscriptionService,
  UsageTrackingService,
  CreditPurchaseService,
} from '@hts/billing';
import { BillingController } from './controllers/billing.controller';
import { CreditController, SubscriptionController } from '@hts/billing';

@Module({
  imports: [
    // Register entities in the main app context where DataSource is available
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      InvoiceEntity,
      UsageRecordEntity,
      CreditPurchaseEntity,
      CreditBalanceEntity,
      AutoTopUpConfigEntity,
    ]),
    BillingPackageModule.forRoot({
      stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    }),
  ],
  providers: [
    // Provide services here so they have access to repositories
    EntitlementService,
    StripeService,
    SubscriptionService,
    UsageTrackingService,
    CreditPurchaseService,
  ],
  controllers: [BillingController, CreditController, SubscriptionController],
  exports: [
    EntitlementService,
    StripeService,
    SubscriptionService,
    UsageTrackingService,
    CreditPurchaseService,
  ],
})
export class BillingModule {}
