import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class InKoreaCepaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'in.korea-cepa.qualifying';
  readonly destination = 'IN';
  readonly agreementCode = 'IN_KR_CEPA';
  readonly title = 'India-Korea CEPA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['in.cbic.korea-cepa-publication'];
  protected readonly qualifyingOrigins = new Set(['KR']);
}
