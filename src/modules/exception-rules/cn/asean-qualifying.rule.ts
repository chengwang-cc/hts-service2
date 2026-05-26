import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class CnAseanQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'cn.asean.qualifying';
  readonly destination = 'CN';
  readonly agreementCode = 'CN_ASEAN';
  readonly title = 'China-ASEAN FTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['cn.mofcom.asean-fta-publication'];
  protected readonly qualifyingOrigins = new Set([
    'BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN',
  ]);
}
