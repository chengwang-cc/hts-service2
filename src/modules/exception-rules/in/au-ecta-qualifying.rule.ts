import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class InAuEctaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'in.au-ecta.qualifying';
  readonly destination = 'IN';
  readonly agreementCode = 'IN_AU_ECTA';
  readonly title = 'India-Australia ECTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['in.cbic.au-ecta-publication'];
  protected readonly qualifyingOrigins = new Set(['AU']);
}
