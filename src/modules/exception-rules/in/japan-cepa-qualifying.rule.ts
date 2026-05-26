import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class InJapanCepaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'in.japan-cepa.qualifying';
  readonly destination = 'IN';
  readonly agreementCode = 'IN_JP_CEPA';
  readonly title = 'India-Japan CEPA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['in.cbic.japan-cepa-publication'];
  protected readonly qualifyingOrigins = new Set(['JP']);
}
