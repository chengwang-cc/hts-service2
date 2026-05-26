import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class CaAdCvdRule extends AdCvdRuleBase {
  readonly id = 'ca.ad-cvd';
  readonly destination = 'CA';
  readonly title = 'CA SIMA AD/CVD (CBSA)';
  readonly knowledgeCardKeys = ['cbsa.sima.measures-in-force'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
