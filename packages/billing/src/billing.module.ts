import { Module, DynamicModule, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { SubscriptionEntity, InvoiceEntity, UsageRecordEntity } from './entities';
import { EntitlementService, StripeService } from './services';
import { EntitlementGuard } from './guards/entitlement.guard';

export interface BillingModuleOptions {
  stripeSecretKey: string;
  stripeWebhookSecret?: string;
  apiVersion?: string;
}

@Global()
@Module({})
export class BillingPackageModule {
  static forRoot(options: BillingModuleOptions): DynamicModule {
    return {
      module: BillingPackageModule,
      imports: [
        TypeOrmModule.forFeature([
          SubscriptionEntity,
          InvoiceEntity,
          UsageRecordEntity,
        ]),
      ],
      providers: [
        {
          provide: 'STRIPE_CLIENT',
          useFactory: () => {
            return new Stripe(options.stripeSecretKey, {
              apiVersion: (options.apiVersion as any) || '2024-11-20.acacia',
            });
          },
        },
        {
          provide: 'STRIPE_WEBHOOK_SECRET',
          useValue: options.stripeWebhookSecret || '',
        },
        EntitlementService,
        StripeService,
        EntitlementGuard,
      ],
      exports: [
        EntitlementService,
        StripeService,
        EntitlementGuard,
      ],
    };
  }
}
