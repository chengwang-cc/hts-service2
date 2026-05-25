import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../admin/guards/admin.guard';
import { AdminPermissionsGuard } from '../admin/guards/admin-permissions.guard';
import { AuditModule } from '../audit/audit.module';
import { MarketplaceBrokerProfileEntity } from '../marketplace/entities';
import {
  MarketplaceBrokerMatchEntity,
  MarketplaceQuoteEntity,
  MarketplaceRequestEntity,
} from '../marketplace-requests/entities';
import {
  MarketplaceReviewsAdminController,
  MarketplaceReviewsController,
} from './controllers/marketplace-reviews.controller';
import {
  BrokerCreditBalanceEntity,
  BrokerCreditLedgerEntity,
  BrokerPerformanceSnapshotEntity,
  MarketplaceReviewEntity,
} from './entities';
import { BrokerCreditsService } from './services/broker-credits.service';
import { BrokerPerformanceService } from './services/broker-performance.service';
import { MarketplaceReviewsService } from './services/marketplace-reviews.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MarketplaceReviewEntity,
      BrokerCreditBalanceEntity,
      BrokerCreditLedgerEntity,
      BrokerPerformanceSnapshotEntity,
      MarketplaceRequestEntity,
      MarketplaceQuoteEntity,
      MarketplaceBrokerMatchEntity,
      MarketplaceBrokerProfileEntity,
    ]),
    AuditModule,
  ],
  controllers: [
    MarketplaceReviewsController,
    MarketplaceReviewsAdminController,
  ],
  providers: [
    MarketplaceReviewsService,
    BrokerPerformanceService,
    BrokerCreditsService,
    AdminGuard,
    AdminPermissionsGuard,
  ],
  exports: [
    MarketplaceReviewsService,
    BrokerPerformanceService,
    BrokerCreditsService,
  ],
})
export class MarketplaceReviewsModule {}
