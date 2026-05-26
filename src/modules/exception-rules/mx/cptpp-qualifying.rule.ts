import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class MxCptppQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'mx.cptpp.qualifying';
  readonly destination = 'MX';
  readonly agreementCode = 'CPTPP';
  readonly title = 'CPTPP — Qualifying preferential treatment (Mexico)';
  readonly knowledgeCardKeys = ['mx.se.cptpp-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'CA', 'CL', 'JP', 'MY', 'NZ', 'PE', 'SG', 'VN', 'GB',
  ]);
}
