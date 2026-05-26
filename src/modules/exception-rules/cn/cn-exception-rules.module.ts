import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { CnAdCvdRule } from './ad-cvd.rule';
import { CnVatRule } from './vat.rule';
import { CnRcepQualifyingRule } from './rcep-qualifying.rule';
import { CnAseanQualifyingRule } from './asean-qualifying.rule';
import { CnAuQualifyingRule } from './au-qualifying.rule';
import { CnKrQualifyingRule } from './kr-qualifying.rule';
import { CnNzQualifyingRule } from './nz-qualifying.rule';
import { CnSgQualifyingRule } from './sg-qualifying.rule';
import { CnSwitzerlandQualifyingRule } from './switzerland-qualifying.rule';
import { CnChileQualifyingRule } from './chile-qualifying.rule';
import { CnPeruQualifyingRule } from './peru-qualifying.rule';

/**
 * CnExceptionRulesModule (Wave 2, CN — 2026-05-26).
 *
 * Rules registered:
 *   - cn.vat.import                    (13% standard / 9% reduced)
 *   - cn.rcep.qualifying
 *   - cn.asean.qualifying              (China-ASEAN FTA — 10 ASEAN origins)
 *   - cn.au.qualifying                 (ChAFTA)
 *   - cn.kr.qualifying                 (China-Korea)
 *   - cn.nz.qualifying                 (China-NZ)
 *   - cn.sg.qualifying                 (China-Singapore)
 *   - cn.switzerland.qualifying        (China-Switzerland)
 *   - cn.chile.qualifying              (China-Chile)
 *   - cn.peru.qualifying               (China-Peru)
 *   - cn.ad-cvd
 *
 * Future rules pending data ingestion:
 *   - cn.consumption-tax.alcohol / .tobacco / .automobile / .cosmetics
 *   - cn.retaliatory.us-additional-tariff (uses ad_cvd_orders orderType=COUNTERMEASURE)
 *   - cn.safeguard (uses ad_cvd_orders orderType=SAFEGUARD)
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [
    CnAdCvdRule,
    CnVatRule,
    CnRcepQualifyingRule,
    CnAseanQualifyingRule,
    CnAuQualifyingRule,
    CnKrQualifyingRule,
    CnNzQualifyingRule,
    CnSgQualifyingRule,
    CnSwitzerlandQualifyingRule,
    CnChileQualifyingRule,
    CnPeruQualifyingRule,
  ],
})
export class CnExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(CnExceptionRulesModule.name);
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: CnAdCvdRule,
    private readonly vat: CnVatRule,
    private readonly rcep: CnRcepQualifyingRule,
    private readonly asean: CnAseanQualifyingRule,
    private readonly au: CnAuQualifyingRule,
    private readonly kr: CnKrQualifyingRule,
    private readonly nz: CnNzQualifyingRule,
    private readonly sg: CnSgQualifyingRule,
    private readonly switzerland: CnSwitzerlandQualifyingRule,
    private readonly chile: CnChileQualifyingRule,
    private readonly peru: CnPeruQualifyingRule,
  ) {}
  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'CnExceptionRulesModule',
      rules: [
        this.vat,
        this.rcep,
        this.asean,
        this.au,
        this.kr,
        this.nz,
        this.sg,
        this.switzerland,
        this.chile,
        this.peru,
        this.adCvd,
      ],
    });
  }
}
