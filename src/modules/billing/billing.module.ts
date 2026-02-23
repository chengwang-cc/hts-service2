import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { BillingController } from './controllers/billing.controller';
import { CreditController } from './controllers/credit.controller';
import { SubscriptionController } from './controllers/subscription.controller';
import { SubscriptionEntity } from './entities/subscription.entity';
import { InvoiceEntity } from './entities/invoice.entity';
import { UsageRecordEntity } from './entities/usage-record.entity';
import { CreditPurchaseEntity } from './entities/credit-purchase.entity';
import { CreditBalanceEntity } from './entities/credit-balance.entity';
import { AutoTopUpConfigEntity } from './entities/auto-topup-config.entity';
import { EntitlementService } from './services/entitlement.service';
import { StripeService } from './services/stripe.service';
import { SubscriptionService } from './services/subscription.service';
import { UsageTrackingService } from './services/usage-tracking.service';
import { CreditPurchaseService } from './services/credit-purchase.service';

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
