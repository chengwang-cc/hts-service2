import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class ThRcepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'th.rcep.qualifying';
  readonly destination = 'TH';
  readonly agreementCode = 'RCEP';
  readonly title = 'RCEP — Qualifying preferential treatment (Thailand)';
  readonly knowledgeCardKeys = ['th.customs.rcep-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'KH', 'CN', 'ID', 'JP', 'KR', 'LA', 'MY', 'MM', 'NZ',
    'PH', 'SG', 'VN',
  ]);
}
