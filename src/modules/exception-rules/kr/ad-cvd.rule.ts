import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class KrAdCvdRule extends AdCvdRuleBase {
  readonly id = 'kr.ad-cvd';
  readonly destination = 'KR';
  readonly title = 'KR AD/CVD (Korea Trade Commission)';
  readonly knowledgeCardKeys = ['kr.ktc.measures'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
