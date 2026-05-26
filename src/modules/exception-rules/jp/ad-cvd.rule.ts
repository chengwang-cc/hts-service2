import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

/**
 * Rule: jp.ad-cvd
 * Authority: Japan METI / Customs anti-dumping + countervailing duties.
 *
 * Subclasses the shared AD/CVD base. Behaves as a stub until OPS loads
 * METI's measures-in-force list into `ad_cvd_orders`.
 *
 * W0.5.T1 (2026-05-26): the per-(dest, origin) lookup uses
 * `JurisdictionCodeNormalizer` to handle Japan's 9-digit national codes
 * correctly. Pre-W0.5.T1 the lookup would have silently padded them.
 */
@Injectable()
export class JpAdCvdRule extends AdCvdRuleBase {
  readonly id = 'jp.ad-cvd';
  readonly destination = 'JP';
  readonly title = 'Japan METI/Customs — AD/CVD orders';
  readonly knowledgeCardKeys = ['jp.meti.adcvd-orders'];
  constructor(lookup: AdCvdLookupService) {
    super(lookup);
  }
}
