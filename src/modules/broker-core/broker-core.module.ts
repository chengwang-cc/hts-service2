import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { SecurityModule } from '../security/security.module';
import {
  BrokerClientsController,
  BusinessRelationshipsController,
} from './controllers/broker-clients.controller';
import {
  BrokerClientEntity,
  BrokerClientRelationshipEntity,
  BrokerPowerOfAttorneyEntity,
} from './entities';
import { BrokerClientsService } from './services/broker-clients.service';
import { BrokerRelationshipsService } from './services/broker-relationships.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BrokerClientEntity,
      BrokerPowerOfAttorneyEntity,
      BrokerClientRelationshipEntity,
    ]),
    AuditModule,
    SecurityModule,
  ],
  controllers: [BrokerClientsController, BusinessRelationshipsController],
  providers: [BrokerClientsService, BrokerRelationshipsService],
  exports: [BrokerClientsService, BrokerRelationshipsService],
})
export class BrokerCoreModule {}
