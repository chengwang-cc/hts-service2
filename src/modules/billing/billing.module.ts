import { Module } from '@nestjs/common';
import { BillingPackageModule } from '@hts/billing';
import { BillingController } from './controllers/billing.controller';

@Module({
  imports: [
    BillingPackageModule.forRoot({
      stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    }),
  ],
  controllers: [BillingController],
})
export class BillingModule {}
