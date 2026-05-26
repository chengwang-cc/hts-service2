import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

/**
 * Rule: au.cptpp.qualifying
 * Authority: CPTPP (Comprehensive and Progressive Trans-Pacific Partnership)
 */
@Injectable()
export class AuCptppQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'au.cptpp.qualifying';
  readonly destination = 'AU';
  readonly agreementCode = 'CPTPP';
  readonly title = 'CPTPP — Qualifying preferential treatment (Australia)';
  readonly knowledgeCardKeys = ['au.dfat.cptpp-overview'];
  protected readonly qualifyingOrigins = new Set([
    'BN', 'CA', 'CL', 'GB', 'JP', 'MY', 'MX', 'NZ', 'PE', 'SG', 'VN',
  ]);
}
