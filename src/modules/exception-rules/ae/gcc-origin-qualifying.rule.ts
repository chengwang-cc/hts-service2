import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

@Injectable()
export class AeGccOriginQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'ae.gcc-origin.qualifying';
  readonly destination = 'AE';
  readonly agreementCode = 'GCC';
  readonly title = 'GCC origin — Qualifying preferential treatment (UAE)';
  readonly knowledgeCardKeys = ['ae.gcc.origin-rules'];
  // GCC member states (excluding AE itself as the destination)
  protected readonly qualifyingOrigins = new Set([
    'BH', 'KW', 'OM', 'QA', 'SA',
  ]);
}
