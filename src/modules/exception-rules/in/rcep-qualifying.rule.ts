import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

/**
 * Note: India did not sign RCEP. Listed here for completeness only —
 * `qualifyingOrigins` is empty. ASEAN-India remains the path for IN.
 *
 * If India ever signs RCEP, populate `qualifyingOrigins` and remove
 * this disclaimer.
 */
@Injectable()
export class InRcepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'in.asean-india.qualifying';
  readonly destination = 'IN';
  readonly agreementCode = 'ASEAN_INDIA';
  readonly title = 'ASEAN-India FTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['in.cbic.asean-india-publication'];
  protected readonly qualifyingOrigins = new Set([
    'BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN',
  ]);
}
