import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class ThAdCvdRule extends AdCvdRuleBase {
  readonly id = 'th.ad-cvd';
  readonly destination = 'TH';
  readonly title = 'Thailand DFT — AD/CVD orders';
  readonly knowledgeCardKeys = ['th.dft.adcvd-orders'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
