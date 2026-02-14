import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule, HtsEntity, HtsEmbeddingEntity } from '@hts/core';
import { SearchService } from './services/search.service';
import { ClassificationService } from './services/classification.service';
import { LookupController } from './controllers/lookup.controller';
import { ProductClassificationEntity } from './entities/product-classification.entity';

@Module({})
export class LookupModule {
  static forRoot(): DynamicModule {
    return {
      module: LookupModule,
      imports: [
        CoreModule.forFeature(),
        TypeOrmModule.forFeature([
          HtsEntity,
          HtsEmbeddingEntity,
          ProductClassificationEntity,
        ]),
      ],
      controllers: [LookupController],
      providers: [SearchService, ClassificationService],
      exports: [SearchService, ClassificationService],
    };
  }
}
