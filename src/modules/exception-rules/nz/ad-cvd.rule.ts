import { Injectable } from '@nestjs/common';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import { AdCvdRuleBase } from '../_shared/ad-cvd-rule.base';

@Injectable()
export class NzAdCvdRule extends AdCvdRuleBase {
  readonly id = 'nz.ad-cvd';
  readonly destination = 'NZ';
  readonly title = 'NZ AD/CVD (MBIE Trade Remedies)';
  readonly knowledgeCardKeys = ['nz.mbie.trade-remedies'];
  constructor(lookup: AdCvdLookupService) { super(lookup); }
}
