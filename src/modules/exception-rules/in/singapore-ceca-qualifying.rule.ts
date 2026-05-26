import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class InSingaporeCecaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'in.singapore-ceca.qualifying';
  readonly destination = 'IN';
  readonly agreementCode = 'IN_SG_CECA';
  readonly title = 'India-Singapore CECA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['in.cbic.singapore-ceca-publication'];
  protected readonly qualifyingOrigins = new Set(['SG']);
}
