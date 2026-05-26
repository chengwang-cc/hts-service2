import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class AuAdCvdRule extends AdCvdRuleBase {
  readonly id = 'au.ad-cvd';
  readonly destination = 'AU';
  readonly title = 'AU Anti-Dumping Commission AD/CVD';
  readonly knowledgeCardKeys = ['au.adc.measures-in-force'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
