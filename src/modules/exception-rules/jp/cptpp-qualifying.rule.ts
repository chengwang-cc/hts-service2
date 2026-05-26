import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

/**
 * Rule: jp.cptpp.qualifying
 * Authority: CPTPP (Comprehensive and Progressive Agreement for Trans-Pacific Partnership)
 *
 * Qualifying origins (CPTPP signatories with Japan as destination):
 *   AU, BN, CA, CL, MX, MY, NZ, PE, SG, VN, GB (UK acceded 2024).
 *
 * Flag: `cptpp_qualifying` — shared across all destinations per the
 * `{agreementCode}_qualifying` convention. The customer ticks it once;
 * every destination's CPTPP rule reads the same flag.
 */
@Injectable()
export class JpCptppQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'jp.cptpp.qualifying';
  readonly destination = 'JP';
  readonly agreementCode = 'CPTPP';
  readonly title = 'CPTPP — Qualifying preferential treatment (Japan)';
  readonly knowledgeCardKeys = ['jp.meti.cptpp-publication'];
  protected readonly qualifyingOrigins = new Set([
    'AU', 'BN', 'CA', 'CL', 'MX', 'MY', 'NZ', 'PE', 'SG', 'VN', 'GB',
  ]);
}
