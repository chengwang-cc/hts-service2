import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class VnRcepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'vn.rcep.qualifying';
  readonly destination = 'VN';
  readonly agreementCode = 'RCEP';
  readonly title = 'RCEP — Qualifying preferential treatment (Vietnam)';
  readonly knowledgeCardKeys = ['vn.tradeportal.rcep-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'KH', 'CN', 'ID', 'JP', 'KR', 'LA', 'MY', 'MM', 'NZ',
    'PH', 'SG', 'TH',
  ]);
}
