import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

/**
 * Rule: kr.korus.qualifying
 * Authority: KORUS FTA (Korea–US)
 * Sources: kr.customs.korus-overview, ustr.korus
 */
@Injectable()
export class KrKorusQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'kr.korus.qualifying';
  readonly destination = 'KR';
  readonly agreementCode = 'KORUS';
  readonly title = 'KORUS — Qualifying preferential treatment (Korea)';
  readonly knowledgeCardKeys = ['kr.customs.korus-overview', 'ustr.korus'];
  protected readonly qualifyingOrigins = new Set(['US']);
}
