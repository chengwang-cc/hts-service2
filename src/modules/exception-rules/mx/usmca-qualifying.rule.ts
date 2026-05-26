import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

/**
 * Rule: mx.usmca.qualifying  (T-MEC)
 * Authority: USMCA / T-MEC (United States–Mexico–Canada Agreement)
 *
 * Mexico-side enforcement of the agreement. Flag `usmca_qualifying`
 * is shared with the US-side rule (`us.usmca.qualifying`) per the
 * `{agreementCode}_qualifying` convention.
 */
@Injectable()
export class MxUsmcaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'mx.usmca.qualifying';
  readonly destination = 'MX';
  readonly agreementCode = 'USMCA';
  readonly title = 'USMCA/T-MEC — Qualifying preferential treatment (Mexico)';
  readonly knowledgeCardKeys = ['mx.se.tmec-implementation'];
  protected readonly qualifyingOrigins = new Set(['US', 'CA']);
}
