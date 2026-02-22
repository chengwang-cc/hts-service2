import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import {
  ProductClassificationEntity,
  ApiUsageEntity,
  SearchService,
  ClassificationService,
  UrlClassifierService,
  RateLimitService,
  RateLimitGuard,
  LookupController,
} from '@hts/lookup';
import { HtsEntity, CoreModule } from '@hts/core';
import { AuthModule } from '../auth/auth.module';

/**
 * Lookup Wrapper Module
 * Provides Lookup services with access to TypeORM repositories
 * in the main app context where DataSource is available
 *
 * Authentication is handled by global JwtAuthGuard in AppModule
 */
@Module({
  imports: [
    HttpModule,
    AuthModule, // Provides JWT authentication components
    CoreModule.forFeature(),
    TypeOrmModule.forFeature([
      ProductClassificationEntity,
      ApiUsageEntity,
      HtsEntity,
    ]),
  ],
  controllers: [LookupController],
  providers: [
    SearchService,
    ClassificationService,
    UrlClassifierService,
    RateLimitService,
    RateLimitGuard,
  ],
  exports: [
    SearchService,
    ClassificationService,
    UrlClassifierService,
    RateLimitService,
  ],
})
export class LookupModule {}
