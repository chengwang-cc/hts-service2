import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class JpRcepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'jp.rcep.qualifying';
  readonly destination = 'JP';
  readonly agreementCode = 'RCEP';
  readonly title = 'RCEP — Qualifying preferential treatment (Japan)';
  readonly knowledgeCardKeys = ['jp.meti.rcep-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'KH', 'CN', 'ID', 'KR', 'LA', 'MY', 'MM', 'NZ',
    'PH', 'SG', 'TH', 'VN',
  ]);
}
