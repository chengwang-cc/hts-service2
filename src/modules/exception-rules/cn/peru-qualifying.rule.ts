import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class CnPeruQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'cn.peru.qualifying';
  readonly destination = 'CN';
  readonly agreementCode = 'CN_PE';
  readonly title = 'China-Peru FTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['cn.mofcom.pe-fta-publication'];
  protected readonly qualifyingOrigins = new Set(['PE']);
}
