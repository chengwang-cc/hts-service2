import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { TwCommodityTaxRule } from './commodity-tax.rule';
import { TwTobaccoAlcoholTaxRule } from './tobacco-alcohol-tax.rule';
import { TwAdCvdRule } from './ad-cvd.rule';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';

@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [TwCommodityTaxRule, TwTobaccoAlcoholTaxRule, TwAdCvdRule],
})
export class TwExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(TwExceptionRulesModule.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly commodity: TwCommodityTaxRule,
    private readonly tobaccoAlcohol: TwTobaccoAlcoholTaxRule,
    private readonly adCvd: TwAdCvdRule,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'TwExceptionRulesModule',
      rules: [this.commodity, this.tobaccoAlcohol, this.adCvd],
    });
  }
}
