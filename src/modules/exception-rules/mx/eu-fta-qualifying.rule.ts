import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

const EU_27 = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];

@Injectable()
export class MxEuFtaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'mx.eu-fta.qualifying';
  readonly destination = 'MX';
  readonly agreementCode = 'MX_EU';
  readonly title = 'Mexico-EU FTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['mx.se.eu-fta-publication'];
  protected readonly qualifyingOrigins = new Set(['EU', ...EU_27]);
}
