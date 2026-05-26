import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class JpAseanCepQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'jp.asean-cep.qualifying';
  readonly destination = 'JP';
  readonly agreementCode = 'AJCEP';
  readonly title = 'ASEAN-Japan CEP — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['jp.meti.ajcep-publication'];
  protected readonly qualifyingOrigins = new Set([
    'BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN',
  ]);
}
