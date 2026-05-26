import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class CnChileQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'cn.chile.qualifying';
  readonly destination = 'CN';
  readonly agreementCode = 'CN_CL';
  readonly title = 'China-Chile FTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['cn.mofcom.cl-fta-publication'];
  protected readonly qualifyingOrigins = new Set(['CL']);
}
