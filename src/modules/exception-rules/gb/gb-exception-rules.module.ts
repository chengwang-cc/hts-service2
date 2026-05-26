import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { GbSteelSafeguardRule } from './steel-safeguard.rule';
import { GbRussiaSanctionsRule } from './russia-sanctions.rule';
import { GbTraAdCvdRule } from './tra-ad-cvd.rule';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';

@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [GbSteelSafeguardRule, GbRussiaSanctionsRule, GbTraAdCvdRule],
})
export class GbExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(GbExceptionRulesModule.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly safeguard: GbSteelSafeguardRule,
    private readonly sanctions: GbRussiaSanctionsRule,
    private readonly adCvd: GbTraAdCvdRule,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'GbExceptionRulesModule',
      rules: [this.safeguard, this.sanctions, this.adCvd],
    });
  }
}
