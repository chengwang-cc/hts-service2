import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class MxJapanEpaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'mx.japan-epa.qualifying';
  readonly destination = 'MX';
  readonly agreementCode = 'MX_JP_EPA';
  readonly title = 'Mexico-Japan EPA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['mx.se.japan-epa-publication'];
  protected readonly qualifyingOrigins = new Set(['JP']);
}
