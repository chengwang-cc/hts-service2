import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

/**
 * Rule: kr.rcep.qualifying
 * Authority: RCEP (Regional Comprehensive Economic Partnership)
 * Sources: kr.customs.rcep-overview
 */
@Injectable()
export class KrRcepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'kr.rcep.qualifying';
  readonly destination = 'KR';
  readonly agreementCode = 'RCEP';
  readonly title = 'RCEP — Qualifying preferential treatment (Korea)';
  readonly knowledgeCardKeys = ['kr.customs.rcep-overview'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'KH', 'CN', 'ID', 'JP', 'LA', 'MY', 'MM', 'NZ',
    'PH', 'SG', 'TH', 'VN',
  ]);
}
