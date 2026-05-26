import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class CnNzQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'cn.nz.qualifying';
  readonly destination = 'CN';
  readonly agreementCode = 'CN_NZ';
  readonly title = 'China-New Zealand FTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['cn.mofcom.nz-fta-publication'];
  protected readonly qualifyingOrigins = new Set(['NZ']);
}
