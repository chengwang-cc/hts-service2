import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class TwAdCvdRule extends AdCvdRuleBase {
  readonly id = 'tw.ad-cvd';
  readonly destination = 'TW';
  readonly title = 'TW AD/CVD (MOEA)';
  readonly knowledgeCardKeys = ['tw.moea.adcvd-measures'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
