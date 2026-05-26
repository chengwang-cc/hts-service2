import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class CnSgQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'cn.sg.qualifying';
  readonly destination = 'CN';
  readonly agreementCode = 'CN_SG';
  readonly title = 'China-Singapore FTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['cn.mofcom.sg-fta-publication'];
  protected readonly qualifyingOrigins = new Set(['SG']);
}
