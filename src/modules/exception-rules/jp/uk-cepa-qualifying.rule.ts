import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class JpUkCepaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'jp.uk-cepa.qualifying';
  readonly destination = 'JP';
  readonly agreementCode = 'JP_UK_CEPA';
  readonly title = 'Japan-UK CEPA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['jp.meti.uk-cepa-publication'];
  protected readonly qualifyingOrigins = new Set(['GB']);
}
