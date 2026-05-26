import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class NzRcepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'nz.rcep.qualifying';
  readonly destination = 'NZ';
  readonly agreementCode = 'RCEP';
  readonly title = 'RCEP — Qualifying preferential treatment (New Zealand)';
  readonly knowledgeCardKeys = ['nz.mfat.rcep-overview'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'KH', 'CN', 'ID', 'JP', 'KR', 'LA', 'MY', 'MM',
    'PH', 'SG', 'TH', 'VN',
  ]);
}
