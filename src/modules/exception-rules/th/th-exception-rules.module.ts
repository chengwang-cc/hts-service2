import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { ThAdCvdRule } from './ad-cvd.rule';
import { ThVatRule } from './vat.rule';
import { ThRcepQualifyingRule } from './rcep-qualifying.rule';

/**
 * ThExceptionRulesModule (Wave 3, TH — 2026-05-26).
 * Future: th.excise.vehicle / .alcohol / .tobacco; th.low-value-parcel.treatment; th.atiga-qualifying; th.jtepa-qualifying.
 * Note: TH uses 11-digit AHTN — JurisdictionCodeNormalizer (W0.5.T1) handles the digit length.
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [ThAdCvdRule, ThVatRule, ThRcepQualifyingRule],
})
export class ThExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(ThExceptionRulesModule.name);
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: ThAdCvdRule,
    private readonly vat: ThVatRule,
    private readonly rcep: ThRcepQualifyingRule,
  ) {}
  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'ThExceptionRulesModule',
      rules: [this.vat, this.rcep, this.adCvd],
    });
  }
}
