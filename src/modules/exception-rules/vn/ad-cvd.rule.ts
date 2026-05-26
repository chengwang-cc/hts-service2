import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class VnAdCvdRule extends AdCvdRuleBase {
  readonly id = 'vn.ad-cvd';
  readonly destination = 'VN';
  readonly title = 'Vietnam MOIT — AD/CVD orders';
  readonly knowledgeCardKeys = ['vn.moit.adcvd-orders'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
