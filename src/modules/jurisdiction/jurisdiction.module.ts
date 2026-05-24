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
import { TARIFF_ADAPTERS } from './interfaces/tariff-jurisdiction-adapter.interface';
import { CalculatorModule } from '../calculator/calculator.module';

const tariffAdaptersProvider: Provider = {
  provide: TARIFF_ADAPTERS,
  useFactory: (
    us: UsHtsAdapter,
    hk: HkFreePortAdapter,
    gb: GbTradeTariffAdapter,
    ca: CaCustomsAdapter,
    eu: EuTaricAdapter,
  ) => [us, hk, gb, ca, eu],
  inject: [
    UsHtsAdapter,
    HkFreePortAdapter,
    GbTradeTariffAdapter,
    CaCustomsAdapter,
    EuTaricAdapter,
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
    TypeOrmModule,
  ],
})
export class JurisdictionModule {}
