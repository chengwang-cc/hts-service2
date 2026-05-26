import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { AuLuxuryCarTaxRule } from './luxury-car-tax.rule';
import { AuWineEqualisationTaxRule } from './wine-equalisation-tax.rule';
import { AuExciseRule } from './excise.rule';
import { AuAanzftaQualifyingRule } from './aanzfta-qualifying.rule';
import { AuChaftaQualifyingRule } from './chafta-qualifying.rule';
import { AuCptppQualifyingRule } from './cptpp-qualifying.rule';
import { AuAdCvdRule } from './ad-cvd.rule';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';

/**
 * AuExceptionRulesModule (Phase 5 + Phase 6 + Phase 9 AD/CVD).
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [
    AuLuxuryCarTaxRule,
    AuWineEqualisationTaxRule,
    AuExciseRule,
    AuAanzftaQualifyingRule,
    AuChaftaQualifyingRule,
    AuCptppQualifyingRule,
    AuAdCvdRule,
  ],
})
export class AuExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(AuExceptionRulesModule.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly lct: AuLuxuryCarTaxRule,
    private readonly wet: AuWineEqualisationTaxRule,
    private readonly excise: AuExciseRule,
    private readonly aanzfta: AuAanzftaQualifyingRule,
    private readonly chafta: AuChaftaQualifyingRule,
    private readonly cptpp: AuCptppQualifyingRule,
    private readonly adCvd: AuAdCvdRule,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'AuExceptionRulesModule',
      rules: [this.lct, this.wet, this.excise, this.aanzfta, this.chafta, this.cptpp, this.adCvd],
    });
  }
}
