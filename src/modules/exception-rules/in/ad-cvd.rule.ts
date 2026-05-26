import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class InAdCvdRule extends AdCvdRuleBase {
  readonly id = 'in.ad-cvd';
  readonly destination = 'IN';
  readonly title = 'India CBIC — AD/CVD orders';
  readonly knowledgeCardKeys = ['in.cbic.adcvd-notifications'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
