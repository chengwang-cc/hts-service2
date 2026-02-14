import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingPackageModule,
  SubscriptionEntity,
  InvoiceEntity,
  UsageRecordEntity,
  EntitlementService,
  StripeService,
  SubscriptionService,
  UsageTrackingService,
} from '@hts/billing';
import { BillingController } from './controllers/billing.controller';

@Module({
  imports: [
    // Register entities in the main app context where DataSource is available
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      InvoiceEntity,
      UsageRecordEntity,
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
  ],
  controllers: [BillingController],
  exports: [
    EntitlementService,
    StripeService,
    SubscriptionService,
    UsageTrackingService,
  ],
})
export class BillingModule {}
