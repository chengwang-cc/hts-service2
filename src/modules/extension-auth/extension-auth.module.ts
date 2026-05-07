import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ApiKeyEntity } from '../api-keys/entities/api-key.entity';
import { ExtensionAuthController } from './extension-auth.controller';
import { ExtensionAuthService } from './extension-auth.service';

@Module({
  imports: [
    AuthModule,
    ApiKeysModule,
    TypeOrmModule.forFeature([ApiKeyEntity]),
  ],
  controllers: [ExtensionAuthController],
  providers: [ExtensionAuthService],
})
export class ExtensionAuthModule {}
