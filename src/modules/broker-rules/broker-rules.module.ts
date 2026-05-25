import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { OrgPermissionsGuard } from '../auth/guards/org-permissions.guard';
import { BrokerClientRelationshipEntity } from '../broker-core/entities/broker-client-relationship.entity';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../broker-entries/entities';
import { BrokerDocumentEntity } from '../broker-packets/entities/broker-document.entity';
import { BrokerRulesController } from './controllers/broker-rules.controller';
import {
  BrokerRuleEntity,
  BrokerValidationResultEntity,
} from './entities';
import { BrokerRuleEngine } from './services/broker-rule-engine.service';
import { BrokerRulesService } from './services/broker-rules.service';

// NOTE: BrokerEntriesModule depends on BrokerRulesService via forwardRef so
// the approve handler can re-validate the entry before flipping status. We
// do NOT import BrokerEntriesModule here — only the entry/line entities
// themselves — to avoid a hard cycle. The single forwardRef is enough.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BrokerRuleEntity,
      BrokerValidationResultEntity,
      BrokerEntryEntity,
      BrokerEntryLineEntity,
      BrokerClientRelationshipEntity,
      BrokerDocumentEntity,
    ]),
    AuditModule,
  ],
  controllers: [BrokerRulesController],
  providers: [BrokerRuleEngine, BrokerRulesService, OrgPermissionsGuard],
  exports: [BrokerRulesService, BrokerRuleEngine],
})
export class BrokerRulesModule {}
