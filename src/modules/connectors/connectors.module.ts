import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuleRef } from '@nestjs/core';
import {
  ConnectorEntity,
  SyncLogEntity,
  ConnectorService,
  ShopifyConnector,
  BrokerConnector,
} from '@hts/connectors';
import { ConnectorsController } from './controllers/connectors.controller';
import { ConnectorSecretRotationController } from './controllers/connector-secret-rotation.controller';
import { ConnectorSecretRotationService } from './services/connector-secret-rotation.service';
import { WebhooksController } from './controllers/webhooks.controller';
import { AuditModule } from '../audit/audit.module';
import { LookupModule } from '../lookup/lookup.module';
import { QueueModule } from '../queue/queue.module';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectorEntity, SyncLogEntity]),
    LookupModule,
    QueueModule,
    SecurityModule,
    AuditModule,
  ],
  controllers: [
    ConnectorsController,
    WebhooksController,
    ConnectorSecretRotationController,
  ],
  providers: [
    ConnectorService,
    ShopifyConnector,
    BrokerConnector,
    ConnectorSecretRotationService,
  ],
  exports: [
    ConnectorService,
    ShopifyConnector,
    BrokerConnector,
    ConnectorSecretRotationService,
  ],
})
export class ConnectorsModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly connectorService: ConnectorService,
  ) {}

  async onModuleInit() {
    // Lazily inject SearchService to avoid circular dependency issues
    try {
      const { SearchService } =
        await import('../lookup/services/search.service');
      const searchService = this.moduleRef.get(SearchService, {
        strict: false,
      });
      this.connectorService.setSearchService(searchService);
    } catch {
      // SearchService not available; sync will skip classification
    }

    // Lazily inject LookupClassificationJobService so we can persist
    // Shopify-originated classifications into the shared history table.
    try {
      const { LookupClassificationJobService } =
        await import('../lookup/services/lookup-classification-job.service');
      const service = this.moduleRef.get(LookupClassificationJobService, {
        strict: false,
      });
      this.connectorService.setLookupClassificationJobService(service);
    } catch {
      // History service not available; Shopify sync will skip history logging
    }
  }
}
