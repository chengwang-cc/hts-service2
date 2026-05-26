import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { IdAdCvdRule } from './ad-cvd.rule';
import { IdPpnRule } from './ppn.rule';
import { IdRcepQualifyingRule } from './rcep-qualifying.rule';

/**
 * IdExceptionRulesModule (Wave 3, ID — 2026-05-26).
 * Future: id.pph22.import; id.ppnbm.luxury; id.lartas.controls; id.ia-cepa-qualifying; id.atiga-qualifying.
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [IdAdCvdRule, IdPpnRule, IdRcepQualifyingRule],
})
export class IdExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(IdExceptionRulesModule.name);
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: IdAdCvdRule,
    private readonly ppn: IdPpnRule,
    private readonly rcep: IdRcepQualifyingRule,
  ) {}
  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'IdExceptionRulesModule',
      rules: [this.ppn, this.rcep, this.adCvd],
    });
  }
}
