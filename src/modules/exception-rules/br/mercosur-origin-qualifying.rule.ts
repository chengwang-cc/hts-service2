import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class BrMercosurOriginQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'br.mercosur-origin.qualifying';
  readonly destination = 'BR';
  readonly agreementCode = 'MERCOSUR';
  readonly title = 'Mercosur intra-bloc — Qualifying preferential treatment (Brazil)';
  readonly knowledgeCardKeys = ['br.mercosur.origin-rules'];
  protected readonly qualifyingOrigins = new Set([
    'AR', 'PY', 'UY', // founding members minus BR itself
    'BO',             // joined 2024
    'VE',             // suspended but still in the treaty
  ]);
}
