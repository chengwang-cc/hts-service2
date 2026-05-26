import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { EuSteelSafeguardRule } from './steel-safeguard.rule';
import { EuRussiaSanctionsRule } from './russia-sanctions.rule';
import { EuAdCvdRule } from './ad-cvd.rule';
import { CbamScopeService } from './cbam-scope.service';
import { CbamEmbeddedCarbonRule } from './cbam-embedded-carbon.rule';
import { CbamQuarterlySettlementService } from './cbam-quarterly-settlement.service';
import { CbamQuarterlySettlementEntity } from './entities/cbam-quarterly-settlement.entity';
import { CbamReportController } from './controllers/cbam-report.controller';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';

/**
 * EuExceptionRulesModule (Phase 6 + Phase 7).
 *
 * Phase 6 rules: steel safeguard, Russia sanctions, AD/CVD stub.
 * Phase 7 rules: CBAM embedded-carbon + quarterly settlement + report XML.
 *
 * All rules ship disabled by default.
 */
@Module({
  imports: [
    ExceptionRulesModule,
    AdCvdSharedModule,
    TypeOrmModule.forFeature([CbamQuarterlySettlementEntity]),
  ],
  controllers: [CbamReportController],
  providers: [
    EuSteelSafeguardRule,
    EuRussiaSanctionsRule,
    EuAdCvdRule,
    CbamScopeService,
    CbamEmbeddedCarbonRule,
    CbamQuarterlySettlementService,
  ],
  exports: [CbamScopeService, CbamQuarterlySettlementService],
})
export class EuExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(EuExceptionRulesModule.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly safeguard: EuSteelSafeguardRule,
    private readonly sanctions: EuRussiaSanctionsRule,
    private readonly adCvd: EuAdCvdRule,
    private readonly cbam: CbamEmbeddedCarbonRule,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'EuExceptionRulesModule',
      rules: [this.safeguard, this.sanctions, this.adCvd, this.cbam],
    });
  }
}
