import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class IdAdCvdRule extends AdCvdRuleBase {
  readonly id = 'id.ad-cvd';
  readonly destination = 'ID';
  readonly title = 'Indonesia KADI — AD/CVD orders';
  readonly knowledgeCardKeys = ['id.kadi.adcvd-orders'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
