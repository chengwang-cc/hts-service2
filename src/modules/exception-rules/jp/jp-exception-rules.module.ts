import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { JpAdCvdRule } from './ad-cvd.rule';
import { JpConsumptionTaxRule } from './consumption-tax.rule';
import { JpCptppQualifyingRule } from './cptpp-qualifying.rule';
import { JpRcepQualifyingRule } from './rcep-qualifying.rule';
import { JpEuEpaQualifyingRule } from './eu-epa-qualifying.rule';
import { JpUkCepaQualifyingRule } from './uk-cepa-qualifying.rule';
import { JpAuEpaQualifyingRule } from './au-epa-qualifying.rule';
import { JpIndiaCepaQualifyingRule } from './india-cepa-qualifying.rule';
import { JpThailandEpaQualifyingRule } from './thailand-epa-qualifying.rule';
import { JpAseanCepQualifyingRule } from './asean-cep-qualifying.rule';

/**
 * JpExceptionRulesModule (Wave 1, JP — 2026-05-26).
 *
 * Rules registered:
 *   - jp.consumption-tax.standard
 *   - jp.cptpp.qualifying
 *   - jp.rcep.qualifying
 *   - jp.eu-epa.qualifying
 *   - jp.ad-cvd
 *
 * Future rules (require data ingestion before production):
 *   - jp.internal-tax.liquor       (per-litre rates by alcohol category)
 *   - jp.internal-tax.tobacco      (per-stick rates)
 *   - jp.uk-cepa.qualifying
 *   - jp.au-epa.qualifying
 *   - jp.india-cepa.qualifying
 *   - jp.thailand-epa.qualifying
 *   - jp.asean-cep.qualifying
 *
 * All rules ship DISABLED. Operators enable per-destination after
 * shadow-comparison + legal review per the rollout sequence.
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [
    JpAdCvdRule,
    JpConsumptionTaxRule,
    JpCptppQualifyingRule,
    JpRcepQualifyingRule,
    JpEuEpaQualifyingRule,
    JpUkCepaQualifyingRule,
    JpAuEpaQualifyingRule,
    JpIndiaCepaQualifyingRule,
    JpThailandEpaQualifyingRule,
    JpAseanCepQualifyingRule,
  ],
})
export class JpExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(JpExceptionRulesModule.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: JpAdCvdRule,
    private readonly consumptionTax: JpConsumptionTaxRule,
    private readonly cptpp: JpCptppQualifyingRule,
    private readonly rcep: JpRcepQualifyingRule,
    private readonly euEpa: JpEuEpaQualifyingRule,
    private readonly ukCepa: JpUkCepaQualifyingRule,
    private readonly auEpa: JpAuEpaQualifyingRule,
    private readonly indiaCepa: JpIndiaCepaQualifyingRule,
    private readonly thailandEpa: JpThailandEpaQualifyingRule,
    private readonly aseanCep: JpAseanCepQualifyingRule,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'JpExceptionRulesModule',
      rules: [
        this.consumptionTax,
        this.cptpp,
        this.rcep,
        this.euEpa,
        this.ukCepa,
        this.auEpa,
        this.indiaCepa,
        this.thailandEpa,
        this.aseanCep,
        this.adCvd,
      ],
    });
  }
}
