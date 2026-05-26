import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class CnRcepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'cn.rcep.qualifying';
  readonly destination = 'CN';
  readonly agreementCode = 'RCEP';
  readonly title = 'RCEP — Qualifying preferential treatment (China)';
  readonly knowledgeCardKeys = ['cn.mofcom.rcep-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'KH', 'ID', 'JP', 'KR', 'LA', 'MY', 'MM', 'NZ',
    'PH', 'SG', 'TH', 'VN',
  ]);
}
