import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LookupModule as LookupPackageModule } from '@hts/lookup';
import {
  ProductClassificationEntity,
  SearchService,
  ClassificationService,
  LookupController,
} from '@hts/lookup';
import { HtsEntity, HtsEmbeddingEntity } from '@hts/core';

@Module({
  imports: [
    LookupPackageModule.forRoot(),
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
