import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class BrAdCvdRule extends AdCvdRuleBase {
  readonly id = 'br.ad-cvd';
  readonly destination = 'BR';
  readonly title = 'Brazil DECOM — AD/CVD orders';
  readonly knowledgeCardKeys = ['br.decom.adcvd-orders'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
