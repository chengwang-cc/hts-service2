import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConnectorsModule as ConnectorsPackageModule } from '@hts/connectors';
import { 
  ConnectorEntity, 
  SyncLogEntity,
  ConnectorService,
  ShopifyConnector,
  BrokerConnector
} from '@hts/connectors';
import { ConnectorsController } from './controllers/connectors.controller';

@Module({
  imports: [
    ConnectorsPackageModule,
    TypeOrmModule.forFeature([ConnectorEntity, SyncLogEntity]),
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
  ],
  controllers: [ConnectorsController],
  providers: [ConnectorService, ShopifyConnector, BrokerConnector],
  exports: [ConnectorService, ShopifyConnector, BrokerConnector],
})
export class ConnectorsModule {}
