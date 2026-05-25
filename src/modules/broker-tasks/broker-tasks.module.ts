import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { OrganizationEntity } from '../auth/entities/organization.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { BrokerClientRelationshipEntity } from '../broker-core/entities/broker-client-relationship.entity';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
  BrokerShipmentEntity,
} from '../broker-entries/entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import {
  BrokerPortalTasksController,
  BrokerTasksController,
} from './controllers/broker-tasks.controller';
import {
  BrokerMissingInfoTaskEntity,
  BrokerStatusEventEntity,
} from './entities';
import { BrokerNotificationsWorker } from './jobs/broker-notifications.worker';
import { BrokerStatusService } from './services/broker-status.service';
import { BrokerTasksService } from './services/broker-tasks.service';
import { MissingInfoAgentService } from './services/missing-info-agent.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BrokerMissingInfoTaskEntity,
      BrokerStatusEventEntity,
      BrokerClientRelationshipEntity,
      BrokerShipmentEntity,
      BrokerEntryEntity,
      BrokerEntryLineEntity,
      UserEntity,
      OrganizationEntity,
    ]),
    AuditModule,
    QueueModule,
    NotificationsModule,
  ],
  controllers: [BrokerTasksController, BrokerPortalTasksController],
  providers: [
    BrokerTasksService,
    BrokerStatusService,
    BrokerNotificationsWorker,
    MissingInfoAgentService,
  ],
  exports: [BrokerTasksService, BrokerStatusService, MissingInfoAgentService],
})
export class BrokerTasksModule {}
