import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrokerAdapterEntity } from '../broker-adapters/entities/broker-adapter.entity';
import { BrokerClientEntity } from '../broker-core/entities/broker-client.entity';
import { EncryptedSecretService } from './encrypted-secret.service';
import { SecretRotationService } from './secret-rotation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BrokerAdapterEntity, BrokerClientEntity]),
  ],
  providers: [EncryptedSecretService, SecretRotationService],
  exports: [EncryptedSecretService, SecretRotationService],
})
export class SecurityModule {}
