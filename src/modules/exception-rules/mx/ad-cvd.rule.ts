import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class MxAdCvdRule extends AdCvdRuleBase {
  readonly id = 'mx.ad-cvd';
  readonly destination = 'MX';
  readonly title = 'Mexico SE/UPCI — AD/CVD orders';
  readonly knowledgeCardKeys = ['mx.se.upci.adcvd-orders'];
  constructor(lookup: AdCvdLookupService) {
    super(lookup);
  }
}
