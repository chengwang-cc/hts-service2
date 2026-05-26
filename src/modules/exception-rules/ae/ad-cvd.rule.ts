import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class AeAdCvdRule extends AdCvdRuleBase {
  readonly id = 'ae.ad-cvd';
  readonly destination = 'AE';
  readonly title = 'UAE/GCC — AD/CVD orders';
  readonly knowledgeCardKeys = ['ae.dubaicustoms.adcvd-orders'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
