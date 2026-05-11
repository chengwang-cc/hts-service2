import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopifySessionEntity } from './entities/shopify-session.entity';
import { ConnectorEntity } from '../connectors/entities/connector.entity';
import { SyncLogEntity } from '../connectors/entities/sync-log.entity';
import { CheckoutOrderEntity } from '../widget/entities/checkout-order.entity';
import { OrganizationEntity } from '../auth/entities/organization.entity';
import { ShopifyAuthService } from './services/shopify-auth.service';
import { ShopifyAuthController } from './controllers/shopify-auth.controller';
import { ShopifyAdminController } from './controllers/shopify-admin.controller';
import { ShopifyGdprController } from './controllers/shopify-gdpr.controller';
import { ShopifySessionGuard } from './guards/shopify-session.guard';
import { ConnectorsModule } from '../connectors/connectors.module';

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
  ],
  controllers: [
    ShopifyAuthController,
    ShopifyAdminController,
    ShopifyGdprController,
  ],
  providers: [ShopifyAuthService, ShopifySessionGuard],
  exports: [ShopifyAuthService],
})
export class ShopifyAppModule {}
