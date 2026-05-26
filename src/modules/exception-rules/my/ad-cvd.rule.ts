import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class MyAdCvdRule extends AdCvdRuleBase {
  readonly id = 'my.ad-cvd';
  readonly destination = 'MY';
  readonly title = 'Malaysia MITI — AD/CVD orders';
  readonly knowledgeCardKeys = ['my.miti.adcvd-orders'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
