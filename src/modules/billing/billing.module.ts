import { Module } from '@nestjs/common';
import { BillingPackageModule } from '@hts/billing';
import { BillingController } from './controllers/billing.controller';

@Module({
  imports: [
    BillingPackageModule.forRoot({
      stripe: {
        apiKey: process.env.STRIPE_SECRET_KEY || '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      },
    }),
  ],
  controllers: [BillingController],
})
export class BillingModule {}
