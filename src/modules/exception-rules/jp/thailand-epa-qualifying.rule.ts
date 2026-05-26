import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class JpThailandEpaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'jp.thailand-epa.qualifying';
  readonly destination = 'JP';
  readonly agreementCode = 'JTEPA';
  readonly title = 'Japan-Thailand EPA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['jp.meti.thailand-epa-publication'];
  protected readonly qualifyingOrigins = new Set(['TH']);
}
