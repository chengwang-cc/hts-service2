import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class JpAuEpaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'jp.au-epa.qualifying';
  readonly destination = 'JP';
  readonly agreementCode = 'JAEPA';
  readonly title = 'Japan-Australia EPA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['jp.meti.au-epa-publication'];
  protected readonly qualifyingOrigins = new Set(['AU']);
}
