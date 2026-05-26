import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { MyAdCvdRule } from './ad-cvd.rule';
import { MySalesTaxRule } from './sales-tax.rule';
import { MyCptppQualifyingRule } from './cptpp-qualifying.rule';
import { MyRcepQualifyingRule } from './rcep-qualifying.rule';

/**
 * MyExceptionRulesModule (Wave 3, MY — 2026-05-26).
 * Future: my.excise.vehicle / .alcohol / .tobacco; my.low-value-goods.sales-tax; my.atiga-qualifying.
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [MyAdCvdRule, MySalesTaxRule, MyCptppQualifyingRule, MyRcepQualifyingRule],
})
export class MyExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(MyExceptionRulesModule.name);
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: MyAdCvdRule,
    private readonly sst: MySalesTaxRule,
    private readonly cptpp: MyCptppQualifyingRule,
    private readonly rcep: MyRcepQualifyingRule,
  ) {}
  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'MyExceptionRulesModule',
      rules: [this.sst, this.cptpp, this.rcep, this.adCvd],
    });
  }
}
