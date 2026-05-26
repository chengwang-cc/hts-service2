import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { PhAdCvdRule } from './ad-cvd.rule';
import { PhVatRule } from './vat.rule';
import { PhRcepQualifyingRule } from './rcep-qualifying.rule';

/**
 * PhExceptionRulesModule (Wave 3, PH — 2026-05-26).
 * Future: ph.excise (alcohol/tobacco/petroleum); ph.atiga-qualifying.
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [PhAdCvdRule, PhVatRule, PhRcepQualifyingRule],
})
export class PhExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(PhExceptionRulesModule.name);
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: PhAdCvdRule,
    private readonly vat: PhVatRule,
    private readonly rcep: PhRcepQualifyingRule,
  ) {}
  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'PhExceptionRulesModule',
      rules: [this.vat, this.rcep, this.adCvd],
    });
  }
}
