import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import {
  BrokerOutreachCampaignEntity,
  BrokerOutreachDiscoveryResultEntity,
  BrokerOutreachDiscoveryRunEntity,
  BrokerOutreachInviteEntity,
  BrokerOutreachLeadEntity,
} from './entities';
import { BrokerOutreachAdminController } from './controllers/broker-outreach-admin.controller';
import { BrokerOutreachPublicController } from './controllers/broker-outreach-public.controller';
import { BrokerOutreachCampaignEngineService } from './services/broker-outreach-campaign-engine.service';
import { CampaignAiDrafterService } from './services/campaign-ai-drafter.service';
import { BrokerOutreachDiscoveryLedgerService } from './services/broker-outreach-discovery-ledger.service';
import { BrokerOutreachRetentionService } from './services/broker-outreach-retention.service';
import {
  BrokerOutreachEmailService,
  LogOnlyOutreachEmailProvider,
} from './services/broker-outreach-email.service';
import { BrokerOutreachService } from './services/broker-outreach.service';
import { GoogleSearchScraperService } from './services/google-search-scraper.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BrokerOutreachLeadEntity,
      BrokerOutreachCampaignEntity,
      BrokerOutreachInviteEntity,
      BrokerOutreachDiscoveryRunEntity,
      BrokerOutreachDiscoveryResultEntity,
    ]),
    AuthModule,
    ApiKeysModule,
    AuditModule,
  ],
  controllers: [BrokerOutreachAdminController, BrokerOutreachPublicController],
  providers: [
    BrokerOutreachService,
    GoogleSearchScraperService,
    BrokerOutreachDiscoveryLedgerService,
    LogOnlyOutreachEmailProvider,
    BrokerOutreachEmailService,
    BrokerOutreachCampaignEngineService,
    BrokerOutreachRetentionService,
    CampaignAiDrafterService,
  ],
  exports: [
    BrokerOutreachService,
    BrokerOutreachDiscoveryLedgerService,
    BrokerOutreachEmailService,
    BrokerOutreachCampaignEngineService,
    BrokerOutreachRetentionService,
  ],
})
export class BrokerOutreachModule {}
