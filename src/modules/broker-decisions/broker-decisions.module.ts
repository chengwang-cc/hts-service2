import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CbpCrossRulingEntity } from '../admin/entities/cbp-cross-ruling.entity';
import { AuditModule } from '../audit/audit.module';
import { OrganizationEntity } from '../auth/entities/organization.entity';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../broker-entries/entities';
import { LookupModule } from '../lookup/lookup.module';
import { QueueModule } from '../queue/queue.module';
import { BrokerDecisionsController } from './controllers/broker-decisions.controller';
import {
  BrokerAiSuggestionEntity,
  BrokerDecisionEntity,
} from './entities';
import { PolicyExposureAgent } from './jobs/policy-exposure-agent.service';
import { BrokerDecisionsService } from './services/broker-decisions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BrokerAiSuggestionEntity,
      BrokerDecisionEntity,
      BrokerEntryEntity,
      BrokerEntryLineEntity,
      CbpCrossRulingEntity,
      OrganizationEntity,
    ]),
    AuditModule,
    LookupModule,
    QueueModule,
  ],
  controllers: [BrokerDecisionsController],
  providers: [BrokerDecisionsService, PolicyExposureAgent],
  exports: [BrokerDecisionsService, PolicyExposureAgent],
})
export class BrokerDecisionsModule {}
