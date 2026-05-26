import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class IdRcepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'id.rcep.qualifying';
  readonly destination = 'ID';
  readonly agreementCode = 'RCEP';
  readonly title = 'RCEP — Qualifying preferential treatment (Indonesia)';
  readonly knowledgeCardKeys = ['id.beacukai.rcep-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'KH', 'CN', 'JP', 'KR', 'LA', 'MY', 'MM', 'NZ',
    'PH', 'SG', 'TH', 'VN',
  ]);
}
