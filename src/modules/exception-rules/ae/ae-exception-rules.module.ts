import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { AeAdCvdRule } from './ad-cvd.rule';
import { AeVatRule } from './vat.rule';
import { AeGccOriginQualifyingRule } from './gcc-origin-qualifying.rule';

/**
 * AeExceptionRulesModule (Wave 4, AE — 2026-05-26).
 * GCC 12-digit national codes — handled by W0.5.T1 JurisdictionCodeNormalizer.
 * Future: ae.excise.tobacco / .energy-drinks / .carbonated-drinks / .sweetened-drinks; ae.gcc-sgfta-qualifying; ae.gcc-efta-qualifying; ae.controls.restricted-prohibited.
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [AeAdCvdRule, AeVatRule, AeGccOriginQualifyingRule],
})
export class AeExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(AeExceptionRulesModule.name);
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: AeAdCvdRule,
    private readonly vat: AeVatRule,
    private readonly gcc: AeGccOriginQualifyingRule,
  ) {}
  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'AeExceptionRulesModule',
      rules: [this.vat, this.gcc, this.adCvd],
    });
  }
}
