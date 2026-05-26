import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ExceptionRulesModule } from '../exception-rules.module';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { AdCvdSharedModule } from '../_shared/ad-cvd-shared.module';
import { registerAndSeedDisabled } from '../_shared/seed-disabled';
import { InAdCvdRule } from './ad-cvd.rule';
import { InIgstImportRule } from './igst.rule';
import { InRcepQualifyingRule } from './rcep-qualifying.rule';
import { InUaeCepaQualifyingRule } from './uae-cepa-qualifying.rule';
import { InAuEctaQualifyingRule } from './au-ecta-qualifying.rule';
import { InJapanCepaQualifyingRule } from './japan-cepa-qualifying.rule';
import { InKoreaCepaQualifyingRule } from './korea-cepa-qualifying.rule';
import { InSingaporeCecaQualifyingRule } from './singapore-ceca-qualifying.rule';

/**
 * InExceptionRulesModule (Wave 2, IN — 2026-05-26).
 *
 * Rules registered:
 *   - in.gst.igst-import               (18% default with HS-driven overrides)
 *   - in.asean-india.qualifying        (ASEAN partner origins)
 *   - in.uae-cepa.qualifying           (UAE origin)
 *   - in.au-ecta.qualifying            (Australia origin)
 *   - in.japan-cepa.qualifying         (Japan origin)
 *   - in.korea-cepa.qualifying         (Korea origin)
 *   - in.singapore-ceca.qualifying     (Singapore origin)
 *   - in.ad-cvd
 *
 * Future rules pending data ingestion:
 *   - in.customs.bcd                  (Basic Customs Duty — HS-driven)
 *   - in.customs.sws                  (Social Welfare Surcharge — 10% on BCD)
 *   - in.gst.compensation-cess        (luxury / sin goods)
 *   - in.exemption-notification        (CBIC notification-based exemptions)
 */
@Module({
  imports: [ExceptionRulesModule, AdCvdSharedModule],
  providers: [
    InAdCvdRule,
    InIgstImportRule,
    InRcepQualifyingRule,
    InUaeCepaQualifyingRule,
    InAuEctaQualifyingRule,
    InJapanCepaQualifyingRule,
    InKoreaCepaQualifyingRule,
    InSingaporeCecaQualifyingRule,
  ],
})
export class InExceptionRulesModule implements OnModuleInit {
  private readonly logger = new Logger(InExceptionRulesModule.name);
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
    private readonly adCvd: InAdCvdRule,
    private readonly igst: InIgstImportRule,
    private readonly aseanIndia: InRcepQualifyingRule,
    private readonly uaeCepa: InUaeCepaQualifyingRule,
    private readonly auEcta: InAuEctaQualifyingRule,
    private readonly jpCepa: InJapanCepaQualifyingRule,
    private readonly krCepa: InKoreaCepaQualifyingRule,
    private readonly sgCeca: InSingaporeCecaQualifyingRule,
  ) {}
  async onModuleInit(): Promise<void> {
    await registerAndSeedDisabled({
      registry: this.registry,
      status: this.status,
      logger: this.logger,
      moduleLabel: 'InExceptionRulesModule',
      rules: [
        this.igst,
        this.aseanIndia,
        this.uaeCepa,
        this.auEcta,
        this.jpCepa,
        this.krCepa,
        this.sgCeca,
        this.adCvd,
      ],
    });
  }
}
