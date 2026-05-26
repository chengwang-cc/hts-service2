import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

/**
 * Rule: au.chafta.qualifying
 * Authority: ChAFTA (China-Australia FTA)
 */
@Injectable()
export class AuChaftaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'au.chafta.qualifying';
  readonly destination = 'AU';
  readonly agreementCode = 'CHAFTA';
  readonly title = 'ChAFTA — Qualifying preferential treatment (Australia)';
  readonly knowledgeCardKeys = ['au.dfat.chafta-overview'];
  protected readonly qualifyingOrigins = new Set(['CN']);
}
