import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  JurisdictionEntity,
  TariffSourceEntity,
  TariffSnapshotEntity,
  SourceCitationEntity,
  LowValueRuleEntity,
  TaxRuleEntity,
  FeeRuleEntity,
  ControlEntity,
} from './entities';
import { JurisdictionService } from './services/jurisdiction.service';
import { AdapterRegistry } from './services/adapter-registry.service';
import { UsHtsAdapter } from './adapters/us-hts.adapter';
import { HkFreePortAdapter } from './adapters/hk/hk-free-port.adapter';
import { HkDutiableCommodityResolverService } from './adapters/hk/services/hk-dutiable-commodity-resolver.service';
import { HkComplianceResolverService } from './adapters/hk/services/hk-compliance-resolver.service';
import { GbTradeTariffAdapter } from './adapters/gb/gb-trade-tariff.adapter';
import { GbTradeTariffIngestionService } from './adapters/gb/services/gb-trade-tariff-ingestion.service';
import { GbMeasureNormalizerService } from './adapters/gb/services/gb-measure-normalizer.service';
import { GbVatRuleResolverService } from './adapters/gb/services/gb-vat-rule-resolver.service';
import { GbControlsResolverService } from './adapters/gb/services/gb-controls-resolver.service';
import { CaCustomsAdapter } from './adapters/ca/ca-customs.adapter';
import { CaTariffLookupService } from './adapters/ca/services/ca-tariff-lookup.service';
import { CaGstHstResolverService } from './adapters/ca/services/ca-gst-hst-resolver.service';
import { CaLowValueResolverService } from './adapters/ca/services/ca-low-value-resolver.service';
import { CaComplianceResolverService } from './adapters/ca/services/ca-compliance-resolver.service';
import { EuTaricAdapter } from './adapters/eu/eu-taric.adapter';
import { EuTaricIngestionService } from './adapters/eu/services/eu-taric-ingestion.service';
import { EuVatRuleResolverService } from './adapters/eu/services/eu-vat-rule-resolver.service';
import { EuIossResolverService } from './adapters/eu/services/eu-ioss-resolver.service';
import { ViesValidationService } from './adapters/eu/services/vies-validation.service';
// Phase B+ Asia-Pacific adapters.
import { KrCustomsAdapter } from './adapters/kr/kr-customs.adapter';
import { KrTariffLookupService } from './adapters/kr/services/kr-tariff-lookup.service';
import { KrVatResolverService } from './adapters/kr/services/kr-vat-resolver.service';
import { SgCustomsAdapter } from './adapters/sg/sg-customs.adapter';
import { SgTariffLookupService } from './adapters/sg/services/sg-tariff-lookup.service';
import { SgGstResolverService } from './adapters/sg/services/sg-gst-resolver.service';
import { AuBorderForceAdapter } from './adapters/au/au-border-force.adapter';
import { AuTariffLookupService } from './adapters/au/services/au-tariff-lookup.service';
import { AuGstResolverService } from './adapters/au/services/au-gst-resolver.service';
import { NzCustomsAdapter } from './adapters/nz/nz-customs.adapter';
import { NzTariffLookupService } from './adapters/nz/services/nz-tariff-lookup.service';
import { NzGstResolverService } from './adapters/nz/services/nz-gst-resolver.service';
import { TwCustomsAdapter } from './adapters/tw/tw-customs.adapter';
import { TwTariffLookupService } from './adapters/tw/services/tw-tariff-lookup.service';
import { TwBusinessTaxResolverService } from './adapters/tw/services/tw-business-tax-resolver.service';
import { TARIFF_ADAPTERS } from './interfaces/tariff-jurisdiction-adapter.interface';
import { CalculatorModule } from '../calculator/calculator.module';
// Wave 1+ (2026-05-26): stub adapter for 11 new destinations.
import {
  StubJurisdictionAdapter,
  STUB_PROFILES,
} from './adapters/stub/stub-jurisdiction.adapter';
import { JurisdictionsAdminController } from './controllers/jurisdictions-admin.controller';

/**
 * One stub adapter per new destination. Production adapters under
 * `adapters/{country}/` will replace each stub when they ship.
 */
const STUB_ADAPTERS = STUB_PROFILES.map((p) => new StubJurisdictionAdapter(p));

const tariffAdaptersProvider: Provider = {
  provide: TARIFF_ADAPTERS,
  useFactory: (
    us: UsHtsAdapter,
    hk: HkFreePortAdapter,
    gb: GbTradeTariffAdapter,
    ca: CaCustomsAdapter,
    eu: EuTaricAdapter,
    kr: KrCustomsAdapter,
    sg: SgCustomsAdapter,
    au: AuBorderForceAdapter,
    nz: NzCustomsAdapter,
    tw: TwCustomsAdapter,
  ) => [us, hk, gb, ca, eu, kr, sg, au, nz, tw, ...STUB_ADAPTERS],
  inject: [
    UsHtsAdapter,
    HkFreePortAdapter,
    GbTradeTariffAdapter,
    CaCustomsAdapter,
    EuTaricAdapter,
    KrCustomsAdapter,
    SgCustomsAdapter,
    AuBorderForceAdapter,
    NzCustomsAdapter,
    TwCustomsAdapter,
  ],
};

@Module({
  imports: [
    CalculatorModule,
    TypeOrmModule.forFeature([
      JurisdictionEntity,
      TariffSourceEntity,
      TariffSnapshotEntity,
      SourceCitationEntity,
      LowValueRuleEntity,
      TaxRuleEntity,
      FeeRuleEntity,
      ControlEntity,
    ]),
  ],
  controllers: [JurisdictionsAdminController],
  providers: [
    JurisdictionService,
    UsHtsAdapter,
    // HK
    HkDutiableCommodityResolverService,
    HkComplianceResolverService,
    HkFreePortAdapter,
    // GB
    GbTradeTariffIngestionService,
    GbMeasureNormalizerService,
    GbVatRuleResolverService,
    GbControlsResolverService,
    GbTradeTariffAdapter,
    // CA
    CaTariffLookupService,
    CaGstHstResolverService,
    CaLowValueResolverService,
    CaComplianceResolverService,
    CaCustomsAdapter,
    // EU
    EuTaricIngestionService,
    EuVatRuleResolverService,
    EuIossResolverService,
    ViesValidationService,
    EuTaricAdapter,
    // Phase B+ Asia-Pacific destinations.
    KrTariffLookupService,
    KrVatResolverService,
    KrCustomsAdapter,
    SgTariffLookupService,
    SgGstResolverService,
    SgCustomsAdapter,
    AuTariffLookupService,
    AuGstResolverService,
    AuBorderForceAdapter,
    NzTariffLookupService,
    NzGstResolverService,
    NzCustomsAdapter,
    TwTariffLookupService,
    TwBusinessTaxResolverService,
    TwCustomsAdapter,
    tariffAdaptersProvider,
    AdapterRegistry,
  ],
  exports: [
    JurisdictionService,
    AdapterRegistry,
    UsHtsAdapter,
    HkFreePortAdapter,
    GbTradeTariffAdapter,
    CaCustomsAdapter,
    EuTaricAdapter,
    KrCustomsAdapter,
    SgCustomsAdapter,
    AuBorderForceAdapter,
    NzCustomsAdapter,
    TwCustomsAdapter,
    TypeOrmModule,
  ],
})
export class JurisdictionModule {}
