import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class MyRcepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'my.rcep.qualifying';
  readonly destination = 'MY';
  readonly agreementCode = 'RCEP';
  readonly title = 'RCEP — Qualifying preferential treatment (Malaysia)';
  readonly knowledgeCardKeys = ['my.miti.rcep-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'KH', 'CN', 'ID', 'JP', 'KR', 'LA', 'MM', 'NZ',
    'PH', 'SG', 'TH', 'VN',
  ]);
}
