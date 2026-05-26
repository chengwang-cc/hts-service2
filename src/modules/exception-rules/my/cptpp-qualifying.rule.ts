import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class MyCptppQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'my.cptpp.qualifying';
  readonly destination = 'MY';
  readonly agreementCode = 'CPTPP';
  readonly title = 'CPTPP — Qualifying preferential treatment (Malaysia)';
  readonly knowledgeCardKeys = ['my.miti.cptpp-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'CA', 'CL', 'JP', 'MX', 'NZ', 'PE', 'SG', 'VN', 'GB',
  ]);
}
