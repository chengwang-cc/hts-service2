import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../admin/guards/admin.guard';
import { AdminPermissionsGuard } from '../admin/guards/admin-permissions.guard';
import { AuditEventEntity } from '../audit/entities/audit-event.entity';
import { BrokerAdaptersModule } from '../broker-adapters/broker-adapters.module';
import {
  BrokerAiSuggestionEntity,
  BrokerDecisionEntity,
} from '../broker-decisions/entities';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../broker-entries/entities';
import {
  BrokerDocumentPacketEntity,
  BrokerExtractedFieldEntity,
} from '../broker-packets/entities';
import { BrokerRulesModule } from '../broker-rules/broker-rules.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import {
  MarketplaceBrokerMatchEntity,
  MarketplaceConversationEntity,
  MarketplaceQuoteEntity,
  MarketplaceRequestEntity,
} from '../marketplace-requests/entities';
import { MarketplaceRequestsModule } from '../marketplace-requests/marketplace-requests.module';
import { BrokerPostEntryModule } from '../broker-post-entry/broker-post-entry.module';
import { MarketplaceReviewEntity } from '../marketplace-reviews/entities';
import { SecurityModule } from '../security/security.module';
import { BrokerAdminController } from './controllers/broker-admin.controller';
import { BrokerAdminService } from './services/broker-admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditEventEntity,
      BrokerEntryEntity,
      BrokerEntryLineEntity,
      BrokerDocumentPacketEntity,
      BrokerExtractedFieldEntity,
      BrokerAiSuggestionEntity,
      BrokerDecisionEntity,
      MarketplaceRequestEntity,
      MarketplaceQuoteEntity,
      MarketplaceBrokerMatchEntity,
      MarketplaceConversationEntity,
      MarketplaceReviewEntity,
    ]),
    MarketplaceModule,
    MarketplaceRequestsModule,
    BrokerRulesModule,
    BrokerAdaptersModule,
    BrokerPostEntryModule,
    SecurityModule,
  ],
  controllers: [BrokerAdminController],
  providers: [BrokerAdminService, AdminGuard, AdminPermissionsGuard],
  exports: [BrokerAdminService],
})
export class BrokerAdminModule {}
