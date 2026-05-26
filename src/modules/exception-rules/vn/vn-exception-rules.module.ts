import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { VnAdCvdRule } from './ad-cvd.rule';
import { VnVatRule } from './vat.rule';
import { VnCptppQualifyingRule } from './cptpp-qualifying.rule';
import { VnRcepQualifyingRule } from './rcep-qualifying.rule';

/**
 * VnExceptionRulesModule (Wave 3, VN — 2026-05-26).
 *
 * Future rules pending data ingestion:
 *   - vn.special-consumption.alcohol / .tobacco / .vehicle
 *   - vn.environmental-protection-tax
 *   - vn.evfta-qualifying (EU-Vietnam FTA)
 *   - vn.atiga-qualifying (ASEAN intra-bloc)
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [VnAdCvdRule, VnVatRule, VnCptppQualifyingRule, VnRcepQualifyingRule],
})
export class VnExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(VnExceptionRulesModule.name);
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: VnAdCvdRule,
    private readonly vat: VnVatRule,
    private readonly cptpp: VnCptppQualifyingRule,
    private readonly rcep: VnRcepQualifyingRule,
  ) {}
  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'VnExceptionRulesModule',
      rules: [this.vat, this.cptpp, this.rcep, this.adCvd],
    });
  }
}
