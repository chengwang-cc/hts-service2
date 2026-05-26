import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { KrSpecialExciseTaxRule } from './special-excise-tax.rule';
import { KrEducationTaxRule } from './education-tax.rule';
import { KrKorusQualifyingRule } from './korus-qualifying.rule';
import { KrRcepQualifyingRule } from './rcep-qualifying.rule';
import { KrAdCvdRule } from './ad-cvd.rule';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';

@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [
    KrSpecialExciseTaxRule,
    KrEducationTaxRule,
    KrKorusQualifyingRule,
    KrRcepQualifyingRule,
    KrAdCvdRule,
  ],
})
export class KrExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(KrExceptionRulesModule.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly special: KrSpecialExciseTaxRule,
    private readonly education: KrEducationTaxRule,
    private readonly korus: KrKorusQualifyingRule,
    private readonly rcep: KrRcepQualifyingRule,
    private readonly adCvd: KrAdCvdRule,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'KrExceptionRulesModule',
      rules: [this.special, this.education, this.korus, this.rcep, this.adCvd],
    });
  }
}
