import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { BrAdCvdRule } from './ad-cvd.rule';
import { BrImportDutyRule } from './ii-import-duty.rule';
import { BrIcmsRule } from './icms.rule';
import { BrMercosurOriginQualifyingRule } from './mercosur-origin-qualifying.rule';

/**
 * BrExceptionRulesModule (Wave 4, BR — 2026-05-26).
 *
 * Brazil is the enterprise-grade complex-market pilot per the source-
 * of-truth plan §III.3 Decision #2. ICMS state input is critical;
 * W0.5.T2 added the `destinationSubdivision` field which the ICMS rule
 * reads (with a legacy fallback to `additionalInputs.br_destination_state`).
 *
 * Future rules pending data ingestion:
 *   - br.ipi.import           (IPI on customs value + II)
 *   - br.pis-import / br.cofins-import (federal contributions)
 *   - br.afrmm.advisory       (Merchant marine fee)
 *   - br.siscomex-fee         (system fee)
 *   - br.icms.tax-base-gross-up   (gross-up calculation)
 *   - br.aladi-preference.qualifying
 *   - br.trade-remedy         (uses ad_cvd_orders orderType=SAFEGUARD)
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [
    BrAdCvdRule,
    BrImportDutyRule,
    BrIcmsRule,
    BrMercosurOriginQualifyingRule,
  ],
})
export class BrExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(BrExceptionRulesModule.name);
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: BrAdCvdRule,
    private readonly ii: BrImportDutyRule,
    private readonly icms: BrIcmsRule,
    private readonly mercosur: BrMercosurOriginQualifyingRule,
  ) {}
  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'BrExceptionRulesModule',
      rules: [this.ii, this.icms, this.mercosur, this.adCvd],
    });
  }
}
