import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class CnKrQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'cn.kr.qualifying';
  readonly destination = 'CN';
  readonly agreementCode = 'CN_KR';
  readonly title = 'China-Korea FTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['cn.mofcom.kr-fta-publication'];
  protected readonly qualifyingOrigins = new Set(['KR']);
}
