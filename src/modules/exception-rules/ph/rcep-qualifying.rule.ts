import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class PhRcepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'ph.rcep.qualifying';
  readonly destination = 'PH';
  readonly agreementCode = 'RCEP';
  readonly title = 'RCEP — Qualifying preferential treatment (Philippines)';
  readonly knowledgeCardKeys = ['ph.tariffcommission.rcep-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'KH', 'CN', 'ID', 'JP', 'KR', 'LA', 'MY', 'MM', 'NZ',
    'SG', 'TH', 'VN',
  ]);
}
