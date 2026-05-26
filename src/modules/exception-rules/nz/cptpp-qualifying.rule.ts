import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class NzCptppQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'nz.cptpp.qualifying';
  readonly destination = 'NZ';
  readonly agreementCode = 'CPTPP';
  readonly title = 'CPTPP — Qualifying preferential treatment (New Zealand)';
  readonly knowledgeCardKeys = ['nz.mfat.cptpp-overview'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'CA', 'CL', 'GB', 'JP', 'MY', 'MX', 'PE', 'SG', 'VN',
  ]);
}
