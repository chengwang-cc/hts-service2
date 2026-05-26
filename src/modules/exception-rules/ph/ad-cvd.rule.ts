import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class PhAdCvdRule extends AdCvdRuleBase {
  readonly id = 'ph.ad-cvd';
  readonly destination = 'PH';
  readonly title = 'Philippines Tariff Commission — AD/CVD orders';
  readonly knowledgeCardKeys = ['ph.tariffcommission.adcvd-orders'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
