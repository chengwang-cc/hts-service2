import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class CnAdCvdRule extends AdCvdRuleBase {
  readonly id = 'cn.ad-cvd';
  readonly destination = 'CN';
  readonly title = 'China MOFCOM/GACC — AD/CVD orders';
  readonly knowledgeCardKeys = ['cn.mofcom.adcvd-orders'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
