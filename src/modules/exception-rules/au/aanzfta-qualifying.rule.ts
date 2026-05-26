import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

/**
 * Rule: au.aanzfta.qualifying
 * Authority: AANZFTA (ASEAN-Australia-New Zealand FTA)
 */
@Injectable()
export class AuAanzftaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'au.aanzfta.qualifying';
  readonly destination = 'AU';
  readonly agreementCode = 'AANZFTA';
  readonly title = 'AANZFTA — Qualifying preferential treatment (Australia)';
  readonly knowledgeCardKeys = ['au.dfat.aanzfta-overview'];
  protected readonly qualifyingOrigins = new Set([
    'NZ', 'BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN',
  ]);
}
