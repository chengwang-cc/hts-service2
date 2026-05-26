import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

const EU_27 = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];

@Injectable()
export class JpEuEpaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'jp.eu-epa.qualifying';
  readonly destination = 'JP';
  readonly agreementCode = 'JP_EU_EPA';
  readonly title = 'Japan-EU EPA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['jp.meti.eu-epa-publication'];
  protected readonly qualifyingOrigins = new Set(['EU', ...EU_27]);
}
