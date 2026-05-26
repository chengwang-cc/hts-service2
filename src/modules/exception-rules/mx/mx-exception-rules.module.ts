import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { MxAdCvdRule } from './ad-cvd.rule';
import { MxIvaRule } from './iva.rule';
import { MxUsmcaQualifyingRule } from './usmca-qualifying.rule';
import { MxCptppQualifyingRule } from './cptpp-qualifying.rule';
import { MxEuFtaQualifyingRule } from './eu-fta-qualifying.rule';
import { MxJapanEpaQualifyingRule } from './japan-epa-qualifying.rule';

/**
 * MxExceptionRulesModule (Wave 1, MX — 2026-05-26).
 *
 * Rules registered:
 *   - mx.iva.standard          (IVA 16% / border-zone 8%)
 *   - mx.usmca.qualifying      (T-MEC US/CA origin)
 *   - mx.cptpp.qualifying
 *   - mx.eu-fta.qualifying
 *   - mx.japan-epa.qualifying
 *   - mx.ad-cvd
 *
 * Future rules (require data ingestion before production):
 *   - mx.dta.standard          (Customs Processing Fee)
 *   - mx.ieps.alcohol / .tobacco / .fuel  (excise)
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [
    MxAdCvdRule,
    MxIvaRule,
    MxUsmcaQualifyingRule,
    MxCptppQualifyingRule,
    MxEuFtaQualifyingRule,
    MxJapanEpaQualifyingRule,
  ],
})
export class MxExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(MxExceptionRulesModule.name);
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: MxAdCvdRule,
    private readonly iva: MxIvaRule,
    private readonly usmca: MxUsmcaQualifyingRule,
    private readonly cptpp: MxCptppQualifyingRule,
    private readonly euFta: MxEuFtaQualifyingRule,
    private readonly japanEpa: MxJapanEpaQualifyingRule,
  ) {}
  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'MxExceptionRulesModule',
      rules: [
        this.iva,
        this.usmca,
        this.cptpp,
        this.euFta,
        this.japanEpa,
        this.adCvd,
      ],
    });
  }
}
