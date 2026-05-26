import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { NzExciseRule } from './excise.rule';
import { NzCptppQualifyingRule } from './cptpp-qualifying.rule';
import { NzRcepQualifyingRule } from './rcep-qualifying.rule';
import { NzNzChinaQualifyingRule } from './nz-china-qualifying.rule';
import { NzAdCvdRule } from './ad-cvd.rule';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';

@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [
    NzExciseRule,
    NzCptppQualifyingRule,
    NzRcepQualifyingRule,
    NzNzChinaQualifyingRule,
    NzAdCvdRule,
  ],
})
export class NzExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(NzExceptionRulesModule.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly excise: NzExciseRule,
    private readonly cptpp: NzCptppQualifyingRule,
    private readonly rcep: NzRcepQualifyingRule,
    private readonly nzChina: NzNzChinaQualifyingRule,
    private readonly adCvd: NzAdCvdRule,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'NzExceptionRulesModule',
      rules: [this.excise, this.cptpp, this.rcep, this.nzChina, this.adCvd],
    });
  }
}
