import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConnectorEntity } from './entities/connector.entity';
import { SyncLogEntity } from './entities/sync-log.entity';
import { ConnectorService } from './services/connector.service';
import { ShopifyConnector } from './services/shopify.connector';
import { BrokerConnector } from './services/broker.connector';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectorEntity, SyncLogEntity]),
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
  ],
  providers: [ConnectorService, ShopifyConnector, BrokerConnector],
  exports: [ConnectorService, ShopifyConnector, BrokerConnector],
})
export class ConnectorsModule {}
