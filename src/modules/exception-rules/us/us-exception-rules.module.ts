import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AluminumScopeService } from './helpers/aluminum-scope.service';
import { SteelScopeService } from './helpers/steel-scope.service';
import { Section301ListLoader } from './helpers/section301-list-loader';
import { Section232AluminumSmeltCastRule } from './section232-aluminum-smelt-cast.rule';
import { Section232SteelMeltPourRule } from './section232-steel-melt-pour.rule';
import { Section232SteelRussiaRule } from './section232-steel-russia.rule';
import { Section232SteelKoreaQuotaRule } from './section232-steel-korea-quota.rule';
import { Section301List1Rule } from './section301-list1.rule';
import { Section301List2Rule } from './section301-list2.rule';
import { Section301List3Rule } from './section301-list3.rule';
import { Section301List4ARule } from './section301-list4a.rule';
import { Section301ExclusionsRule } from './section301-exclusions.rule';
// Phase 4
import { IeepaFentanylCnRule } from './ieepa-fentanyl-cn.rule';
import { IeepaFentanylMxRule } from './ieepa-fentanyl-mx.rule';
import { IeepaFentanylCaRule } from './ieepa-fentanyl-ca.rule';
import { IeepaReciprocalBaselineRule } from './ieepa-reciprocal-baseline.rule';
import { Chapter98UsGoodsReturnedRule } from './chapter98-us-goods-returned.rule';
import { UsmcaQualifyingRule } from './usmca-qualifying.rule';
import { Section201SolarRule } from './section201-solar.rule';
// Phase 9
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { UsAdCvdRule } from './ad-cvd.rule';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';

/**
 * UsExceptionRulesModule (Phase 2 + Phase 3).
 *
 * Registers every US exception rule into the shared registry at boot and
 * — critically — seeds them as DISABLED via `RuleStatusService` so they
 * do NOT change quote output until an operator explicitly enables them.
 *
 * Why disabled by default?
 *   The legacy `metal-tariff-splitter.helper.ts` is still wired into the
 *   resolver. When a smelt/cast rule is enabled, its `removeKeys` clause
 *   drops the splitter-emitted aluminum/steel row and replaces it with
 *   the correctly-attributed (Chapter 99 + smelt/cast) row. Enabling
 *   without first capturing the Phase-0 baseline + diffing would risk a
 *   subtle change in numbers; we ship the rules dormant and let
 *   operators (a) capture baseline (b) flip-on per rule (c) diff (d)
 *   retire the splitter (P3.T8).
 *
 * Activation procedure documented in
 *   docs/2026-05-26/1620_calculator-v2-exception-rule-engine-execution-plan.md §"Rollout & Rollback".
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [
    AluminumScopeService,
    SteelScopeService,
    Section301ListLoader,
    Section232AluminumSmeltCastRule,
    Section232SteelMeltPourRule,
    Section232SteelRussiaRule,
    Section232SteelKoreaQuotaRule,
    Section301List1Rule,
    Section301List2Rule,
    Section301List3Rule,
    Section301List4ARule,
    Section301ExclusionsRule,
    // Phase 4 rules
    IeepaFentanylCnRule,
    IeepaFentanylMxRule,
    IeepaFentanylCaRule,
    IeepaReciprocalBaselineRule,
    Chapter98UsGoodsReturnedRule,
    UsmcaQualifyingRule,
    Section201SolarRule,
    // Phase 9
    UsAdCvdRule,
  ],
  exports: [
    AluminumScopeService,
    SteelScopeService,
    Section301ListLoader,
  ],
})
export class UsExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(UsExceptionRulesModule.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly aluminumSmeltCast: Section232AluminumSmeltCastRule,
    private readonly steelMeltPour: Section232SteelMeltPourRule,
    private readonly steelRussia: Section232SteelRussiaRule,
    private readonly steelKoreaQuota: Section232SteelKoreaQuotaRule,
    private readonly s301List1: Section301List1Rule,
    private readonly s301List2: Section301List2Rule,
    private readonly s301List3: Section301List3Rule,
    private readonly s301List4a: Section301List4ARule,
    private readonly s301Exclusions: Section301ExclusionsRule,
    private readonly ieepaFentanylCn: IeepaFentanylCnRule,
    private readonly ieepaFentanylMx: IeepaFentanylMxRule,
    private readonly ieepaFentanylCa: IeepaFentanylCaRule,
    private readonly ieepaReciprocal: IeepaReciprocalBaselineRule,
    private readonly chapter98Returned: Chapter98UsGoodsReturnedRule,
    private readonly usmcaQualifying: UsmcaQualifyingRule,
    private readonly section201Solar: Section201SolarRule,
    private readonly adCvd: UsAdCvdRule,
  ) {}

  async onModuleInit(): Promise<void> {
    const rules = [
      this.aluminumSmeltCast,
      this.steelMeltPour,
      this.steelRussia,
      this.steelKoreaQuota,
      this.s301List1,
      this.s301List2,
      this.s301List3,
      this.s301List4a,
      this.s301Exclusions,
      this.ieepaFentanylCn,
      this.ieepaFentanylMx,
      this.ieepaFentanylCa,
      this.ieepaReciprocal,
      this.chapter98Returned,
      this.usmcaQualifying,
      this.section201Solar,
      this.adCvd,
    ];

    // H9 fix (2026-05-27): batched register + status seed (one
    // `status.list()` call instead of N).
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'UsExceptionRulesModule',
      rules,
    });
  }
}
