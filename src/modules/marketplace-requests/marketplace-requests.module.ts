import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { OrganizationEntity } from '../auth/entities/organization.entity';
import { BillingModule } from '../billing/billing.module';
import { UserEntity } from '../auth/entities/user.entity';
import { BrokerCoreModule } from '../broker-core/broker-core.module';
import { BrokerClientEntity } from '../broker-core/entities/broker-client.entity';
import { BrokerEntriesModule } from '../broker-entries/broker-entries.module';
import { DocumentsModule } from '../documents/documents.module';
import { MarketplaceReviewsModule } from '../marketplace-reviews/marketplace-reviews.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import {
  MarketplaceBrokerCredentialEntity,
  MarketplaceBrokerProfileEntity,
} from '../marketplace/entities';
import {
  MarketplaceBrokerLeadsController,
  MarketplaceRequestsController,
} from './controllers/marketplace-requests.controller';
import {
  MarketplaceBrokerMatchEntity,
  MarketplaceConversationEntity,
  MarketplaceMessageEntity,
  MarketplaceQuoteEntity,
  MarketplaceRequestEntity,
} from './entities';
import { MarketplaceQuoteExpiryWorker } from './jobs/marketplace-quote-expiry.worker';
import { MarketplaceRemindersWorker } from './jobs/marketplace-reminders.worker';
import { BrokerMatchingService } from './services/broker-matching.service';
import { MarketplaceRequestsService } from './services/marketplace-requests.service';
import { RequestPreflightService } from './services/request-preflight.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MarketplaceRequestEntity,
      MarketplaceBrokerMatchEntity,
      MarketplaceQuoteEntity,
      MarketplaceConversationEntity,
      MarketplaceMessageEntity,
      MarketplaceBrokerProfileEntity,
      MarketplaceBrokerCredentialEntity,
      BrokerClientEntity,
      OrganizationEntity,
      UserEntity,
    ]),
    AuditModule,
    BrokerCoreModule,
    BrokerEntriesModule,
    DocumentsModule,
    QueueModule,
    BillingModule,
    NotificationsModule,
    MarketplaceReviewsModule,
  ],
  controllers: [
    MarketplaceRequestsController,
    MarketplaceBrokerLeadsController,
  ],
  providers: [
    MarketplaceRequestsService,
    RequestPreflightService,
    BrokerMatchingService,
    MarketplaceQuoteExpiryWorker,
    MarketplaceRemindersWorker,
  ],
  exports: [MarketplaceRequestsService, RequestPreflightService],
})
export class MarketplaceRequestsModule {}
