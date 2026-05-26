import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class InUaeCepaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'in.uae-cepa.qualifying';
  readonly destination = 'IN';
  readonly agreementCode = 'IN_UAE_CEPA';
  readonly title = 'India-UAE CEPA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['in.cbic.uae-cepa-publication'];
  protected readonly qualifyingOrigins = new Set(['AE']);
}
