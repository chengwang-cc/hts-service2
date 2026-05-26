import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopifySessionEntity } from './entities/shopify-session.entity';
import { ConnectorEntity } from '../connectors/entities/connector.entity';
import { SyncLogEntity } from '../connectors/entities/sync-log.entity';
import { CheckoutOrderEntity } from '../widget/entities/checkout-order.entity';
import { OrganizationEntity } from '../auth/entities/organization.entity';
import { ShopifyAuthService } from './services/shopify-auth.service';
import {
  ShopifyOrderWritebackService,
  SHOPIFY_ORDER_WRITEBACK_QUEUE,
  type OrderWritebackJobData,
} from './services/shopify-order-writeback.service';
import { ShopifyOrderTransactionsService } from './services/shopify-order-transactions.service';
import { ShopifyAuthController } from './controllers/shopify-auth.controller';
import { ShopifyAdminController } from './controllers/shopify-admin.controller';
import { ShopifyGdprController } from './controllers/shopify-gdpr.controller';
import { ShopifyOrdersController } from './controllers/shopify-orders.controller';
import { ShopifySessionGuard } from './guards/shopify-session.guard';
import { ConnectorsModule } from '../connectors/connectors.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { QueueModule } from '../queue/queue.module';
import { QueueService } from '../queue/queue.service';
import { BillingModule } from '../billing/billing.module';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShopifySessionEntity,
      ConnectorEntity,
      SyncLogEntity,
      CheckoutOrderEntity,
      OrganizationEntity,
    ]),
    ConnectorsModule,
    ApiKeysModule,
    CalculatorModule,
    QueueModule,
    BillingModule,
    SecurityModule,
  ],
  controllers: [
    ShopifyAuthController,
    ShopifyAdminController,
    ShopifyGdprController,
    ShopifyOrdersController,
  ],
  providers: [
    ShopifyAuthService,
    ShopifySessionGuard,
    ShopifyOrderWritebackService,
    ShopifyOrderTransactionsService,
  ],
  exports: [
    ShopifyAuthService,
    ShopifyOrderWritebackService,
    ShopifyOrderTransactionsService,
  ],
})
export class ShopifyAppModule implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly writebackService: ShopifyOrderWritebackService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queueService.registerHandler(
      SHOPIFY_ORDER_WRITEBACK_QUEUE,
      async (job) => {
        await this.writebackService.processOrder(
          job.data as OrderWritebackJobData,
        );
      },
      { teamSize: 1, teamConcurrency: 4 },
    );
  }
}
