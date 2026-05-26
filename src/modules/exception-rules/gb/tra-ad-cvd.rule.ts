import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

/**
 * Rule: gb.ad-cvd  (Phase 9 — promoted from Phase-6 sync stub to
 * the async shared base. Behaves identically when `ad_cvd_orders` is
 * empty; emits real cash-deposit components once Phase 9 OPS loads
 * the TRA case list.)
 *
 * W0.5.T6 (2026-05-26): renamed `gb.tra.ad-cvd` → `gb.ad-cvd` for
 * convention consistency. Every other AD/CVD rule is `{country}.ad-cvd`
 * with no regulator-name segment. The bulk-matrix gap spec already
 * resolves the ID at runtime so e2e tests survive the rename.
 */
@Injectable()
export class GbTraAdCvdRule extends AdCvdRuleBase {
  readonly id = 'gb.ad-cvd';
  readonly destination = 'GB';
  readonly title = 'UK TRA — AD/CVD orders';
  readonly knowledgeCardKeys = ['gb.tra.ad-cvd-database'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
