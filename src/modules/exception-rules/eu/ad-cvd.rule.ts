import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

/**
 * Rule: eu.ad-cvd  (Phase 9 — promoted from Phase-6 sync stub to the
 * async shared base. Same caveat: dormant until OPS populates the
 * `ad_cvd_orders` table for EU.)
 */
@Injectable()
export class EuAdCvdRule extends AdCvdRuleBase {
  readonly id = 'eu.ad-cvd';
  readonly destination = 'EU';
  readonly title = 'EU AD/CVD orders';
  readonly knowledgeCardKeys = ['eu.commission.ad-cvd-database'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
