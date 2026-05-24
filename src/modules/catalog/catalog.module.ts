import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ProductEntity,
  ProductVariantEntity,
  ProductMaterialEntity,
  ProductImageEntity,
  ClassificationEntity,
  ClassificationCandidateEntity,
} from './entities';
import { CatalogService } from './services/catalog.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      ProductVariantEntity,
      ProductMaterialEntity,
      ProductImageEntity,
      ClassificationEntity,
      ClassificationCandidateEntity,
    ]),
  ],
  providers: [CatalogService],
  exports: [CatalogService, TypeOrmModule],
})
export class CatalogModule {}
