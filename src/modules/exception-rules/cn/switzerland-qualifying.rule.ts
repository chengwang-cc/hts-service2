import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class CnSwitzerlandQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'cn.switzerland.qualifying';
  readonly destination = 'CN';
  readonly agreementCode = 'CN_CH';
  readonly title = 'China-Switzerland FTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['cn.mofcom.ch-fta-publication'];
  protected readonly qualifyingOrigins = new Set(['CH']);
}
