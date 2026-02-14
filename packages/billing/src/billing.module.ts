import { Module, DynamicModule, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { SubscriptionEntity, InvoiceEntity, UsageRecordEntity } from './entities';
import {
  EntitlementService,
  StripeService,
  SubscriptionService,
  UsageTrackingService,
} from './services';
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
        // TypeOrmModule.forFeature() removed - entities registered in wrapper module
        // to ensure DataSource is available in the main app context
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
        // Services removed - will be provided in wrapper module where repositories are available
      ],
      exports: [
        'STRIPE_CLIENT',
        'STRIPE_WEBHOOK_SECRET',
      ],
    };
  }
}
