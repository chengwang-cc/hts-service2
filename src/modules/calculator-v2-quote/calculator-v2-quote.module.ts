import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalculatorV2QuoteService } from './calculator-v2-quote.service';
import { JurisdictionFactsService } from './jurisdiction-facts.service';
import { FxRecordService } from './fx-record.service';
import { FxRateProviderService } from './fx-rate-provider.service';
import { CalculatorV2AuditService } from './calculator-v2-audit.service';
import { CalculatorV2QuoteController } from './controllers/calculator-v2-quote.controller';
import { FxRecordEntity } from './entities/fx-record.entity';
import { TypeOrmFxStore } from './typeorm-fx.store';
import { JurisdictionModule } from '../jurisdiction/jurisdiction.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PublicApiModule } from '../public-api/public-api.module';

/**
 * CalculatorV2QuoteModule (Phase A)
 *
 * Owns the unified `POST /api/v1/calculator/v2/quote` (JWT) and
 * `POST /api/v2/calculator/quote` (API-key) routes. Routes all
 * destinations through the AdapterRegistry so US/CA/GB/EU/HK/KR/SG/AU/NZ/TW
 * return the same RichCalculationResult shape.
 *
 * Lives in its own module so it can depend on both JurisdictionModule
 * (for AdapterRegistry + JurisdictionService) and CalculatorModule (for
 * formula evaluation services) without introducing a CalculatorModule ↔
 * JurisdictionModule cycle.
 */
@Module({
  imports: [
    JurisdictionModule,
    CalculatorModule,
    ApiKeysModule,
    PublicApiModule, // for CalculationHistoryService
    TypeOrmModule.forFeature([FxRecordEntity]),
  ],
  controllers: [CalculatorV2QuoteController],
  providers: [
    CalculatorV2QuoteService,
    JurisdictionFactsService,
    // Phase F audit + FX. FxRecordService starts on an in-memory store and
    // OnModuleInit promotes the TypeORM-backed store as the default. Until
    // `scripts/generate-migration.sh fx-records` is run + applied the
    // `fx_records` table doesn't exist; the TypeORM store tolerates that
    // (writes log + drop instead of throwing).
    FxRecordService,
    FxRateProviderService,
    TypeOrmFxStore,
    CalculatorV2AuditService,
  ],
  exports: [
    CalculatorV2QuoteService,
    JurisdictionFactsService,
    FxRecordService,
    FxRateProviderService,
    CalculatorV2AuditService,
  ],
})
export class CalculatorV2QuoteModule implements OnModuleInit {
  constructor(
    private readonly fxRecord: FxRecordService,
    private readonly typeormFxStore: TypeOrmFxStore,
  ) {}

  onModuleInit(): void {
    // Swap the in-memory FxStore for the TypeORM-backed one at boot. The
    // store implementation is best-effort — even if the table doesn't
    // exist yet (migration not run), writes log a warning rather than
    // failing the calculator path.
    this.fxRecord.configureStore(this.typeormFxStore);
  }
}
