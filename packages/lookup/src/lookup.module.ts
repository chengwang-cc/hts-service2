import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '@hts/core';
import { ProductClassificationEntity } from './entities/product-classification.entity';
import { SearchService, ClassificationService } from './services';
import { LookupController } from './controllers/lookup.controller';

@Module({})
export class LookupModule {
  static forRoot(): DynamicModule {
    return {
      module: LookupModule,
      imports: [
        CoreModule.forFeature(),
        TypeOrmModule.forFeature([ProductClassificationEntity]),
      ],
      controllers: [LookupController],
      providers: [SearchService, ClassificationService],
      exports: [SearchService, ClassificationService],
    };
  }
}
