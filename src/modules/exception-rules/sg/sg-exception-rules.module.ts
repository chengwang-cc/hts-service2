import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { SgExciseRule } from './excise.rule';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';

/**
 * SgExceptionRulesModule (Phase 5).
 * Registers Singapore-destination excise rule disabled by default.
 *
 * SG is a free port; the rule covers the four dutiable categories
 * (alcohol, tobacco, petroleum, motor vehicles).
 */
@Module({
  imports: [ExceptionRulesModule],
  providers: [SgExciseRule],
})
export class SgExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(SgExceptionRulesModule.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly excise: SgExciseRule,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'SgExceptionRulesModule',
      rules: [this.excise],
    });
  }
}
