import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { OrgPermissionsGuard } from '../auth/guards/org-permissions.guard';
import { BrokerClientEntity } from '../broker-core/entities/broker-client.entity';
import { BrokerRulesModule } from '../broker-rules/broker-rules.module';
import { LandedCostModule } from '../landed-cost/landed-cost.module';
import { BrokerEntriesController } from './controllers/broker-entries.controller';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
  BrokerShipmentEntity,
} from './entities';
import { BrokerDutyEstimatorService } from './services/broker-duty-estimator.service';
import { BrokerEntriesService } from './services/broker-entries.service';
import { BrokerShipmentsService } from './services/broker-shipments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BrokerShipmentEntity,
      BrokerEntryEntity,
      BrokerEntryLineEntity,
      BrokerClientEntity,
    ]),
    AuditModule,
    forwardRef(() => BrokerRulesModule),
    LandedCostModule,
  ],
  controllers: [BrokerEntriesController],
  providers: [
    BrokerEntriesService,
    BrokerShipmentsService,
    BrokerDutyEstimatorService,
    OrgPermissionsGuard,
  ],
  exports: [
    BrokerEntriesService,
    BrokerShipmentsService,
    BrokerDutyEstimatorService,
  ],
})
export class BrokerEntriesModule {}
