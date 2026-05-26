import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExceptionRuleRegistry } from './exception-rule.registry';
import { ExceptionRuleRunnerService } from './exception-rule-runner.service';
import { RuleStatusService } from './rule-status.service';
import { RuleStatusEntity } from './entities/rule-status.entity';
import { ExceptionRulesAdminController } from './controllers/exception-rules-admin.controller';

/**
 * ExceptionRulesModule (Phase 1, P1.T1).
 *
 * Provides the registry, the runner, the status service, and the admin
 * surface. Phase 1 registers NO rules — the runner is a transparent
 * pass-through. Country-scoped per-rule modules (`us`, `ca`, `gb`, …)
 * register their rules in their own NestJS sub-modules in P2+.
 *
 * Consumers of the runner (currently just `CalculatorV2QuoteModule`)
 * import this module to get the runner injected.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RuleStatusEntity])],
  controllers: [ExceptionRulesAdminController],
  providers: [
    ExceptionRuleRegistry,
    RuleStatusService,
    ExceptionRuleRunnerService,
  ],
  exports: [
    ExceptionRuleRegistry,
    RuleStatusService,
    ExceptionRuleRunnerService,
  ],
})
export class ExceptionRulesModule {}
