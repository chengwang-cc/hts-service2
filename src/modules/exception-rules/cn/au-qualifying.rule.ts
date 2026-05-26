import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class CnAuQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'cn.au.qualifying';
  readonly destination = 'CN';
  readonly agreementCode = 'CHAFTA_CN';
  readonly title = 'China-Australia FTA (ChAFTA) — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['cn.mofcom.au-fta-publication'];
  protected readonly qualifyingOrigins = new Set(['AU']);
}
