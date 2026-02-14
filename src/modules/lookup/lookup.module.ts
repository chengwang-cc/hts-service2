import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ProductClassificationEntity,
  SearchService,
  ClassificationService,
  LookupController,
} from '@hts/lookup';
import { HtsEntity, HtsEmbeddingEntity, CoreModule } from '@hts/core';

/**
 * Lookup Wrapper Module
 * Provides Lookup services with access to TypeORM repositories
 * in the main app context where DataSource is available
 */
@Module({
  imports: [
    // Import CoreModule for shared services (OpenAI, etc.)
    CoreModule.forFeature(),
    // Register entities in the main app context where DataSource is available
    TypeOrmModule.forFeature([
      ProductClassificationEntity,
      HtsEntity,
      HtsEmbeddingEntity,
    ]),
  ],
  controllers: [LookupController],
  providers: [SearchService, ClassificationService],
  exports: [SearchService, ClassificationService],
})
export class LookupModule {}
