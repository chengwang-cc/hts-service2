import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

/**
 * Rule: nz.nz-china.qualifying
 * Authority: NZ-China FTA (2008, upgraded 2022).
 */
@Injectable()
export class NzNzChinaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'nz.nz-china.qualifying';
  readonly destination = 'NZ';
  readonly agreementCode = 'NZ-CHINA';
  readonly title = 'NZ-China FTA — Qualifying preferential treatment';
  readonly knowledgeCardKeys = ['nz.mfat.nz-china-fta'];
  protected readonly qualifyingOrigins = new Set(['CN']);
}
