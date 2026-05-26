import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdCvdOrderEntity } from './ad-cvd-orders.entity';
import { AdCvdLookupService } from './ad-cvd-lookup.service';
import { AdCvdImporterService } from './ad-cvd-importer.service';
import { AdCvdAdminController } from './controllers/ad-cvd-admin.controller';
import { JurisdictionCodeNormalizer } from './jurisdiction-code';

/**
 * AdCvdSharedModule (Phase 6 + Phase 9).
 *
 * Phase 6: lookup service + entity.
 * Phase 9: importer service + admin controller for CSV upload + seed.
 *
 * Exposes the AdCvdLookupService + entity to every per-jurisdiction
 * AD/CVD rule module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AdCvdOrderEntity])],
  controllers: [AdCvdAdminController],
  providers: [AdCvdLookupService, AdCvdImporterService, JurisdictionCodeNormalizer],
  exports: [
    AdCvdLookupService,
    AdCvdImporterService,
    JurisdictionCodeNormalizer,
    TypeOrmModule,
  ],
})
export class AdCvdSharedModule {}
