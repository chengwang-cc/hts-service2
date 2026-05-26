import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class VnCptppQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'vn.cptpp.qualifying';
  readonly destination = 'VN';
  readonly agreementCode = 'CPTPP';
  readonly title = 'CPTPP — Qualifying preferential treatment (Vietnam)';
  readonly knowledgeCardKeys = ['vn.tradeportal.cptpp-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'CA', 'CL', 'JP', 'MY', 'MX', 'NZ', 'PE', 'SG', 'GB',
  ]);
}
