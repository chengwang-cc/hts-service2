import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class UsAdCvdRule extends AdCvdRuleBase {
  readonly id = 'us.ad-cvd';
  readonly destination = 'US';
  readonly title = 'US AD/CVD (USDOC + USITC)';
  readonly knowledgeCardKeys = [
    'usdoc.adcvd.access-trade-gov',
    'usitc.publication.4866',
  ];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
