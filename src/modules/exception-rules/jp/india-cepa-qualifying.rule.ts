import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class JpIndiaCepaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'jp.india-cepa.qualifying';
  readonly destination = 'JP';
  readonly agreementCode = 'JICEPA';
  readonly title = 'Japan-India CEPA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['jp.meti.india-cepa-publication'];
  protected readonly qualifyingOrigins = new Set(['IN']);
}
