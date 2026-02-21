import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import Stripe from 'stripe';
import {
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
  CreditController,
  SubscriptionController,
} from '@hts/billing';
import { BillingController } from './controllers/billing.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      InvoiceEntity,
      UsageRecordEntity,
      CreditPurchaseEntity,
      CreditBalanceEntity,
      AutoTopUpConfigEntity,
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
