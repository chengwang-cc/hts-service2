import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { CaSurtaxCnEvRule } from './surtax-cn-ev.rule';
import { CaSurtaxCnSteelAluminumRule } from './surtax-cn-steel-aluminum.rule';
import { CaCountermeasureUs232Rule } from './countermeasure-us-232.rule';
import { CaCusmaQualifyingRule } from './cusma-qualifying.rule';
import { CaAdCvdRule } from './ad-cvd.rule';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';

/**
 * CaExceptionRulesModule (Phase 6 + Phase 9 AD/CVD).
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [
    CaSurtaxCnEvRule,
    CaSurtaxCnSteelAluminumRule,
    CaCountermeasureUs232Rule,
    CaCusmaQualifyingRule,
    CaAdCvdRule,
  ],
})
export class CaExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(CaExceptionRulesModule.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly cnEv: CaSurtaxCnEvRule,
    private readonly cnSteel: CaSurtaxCnSteelAluminumRule,
    private readonly counterUs: CaCountermeasureUs232Rule,
    private readonly cusma: CaCusmaQualifyingRule,
    private readonly adCvd: CaAdCvdRule,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'CaExceptionRulesModule',
      rules: [this.cnEv, this.cnSteel, this.counterUs, this.cusma, this.adCvd],
    });
  }
}
