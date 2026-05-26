import { Injectable } from '@nestjs/common';
import { FtaQualifyingRuleBase } from '../shared/fta-qualifying.base';

/**
 * Rule: ca.cusma.qualifying
 * Authority: CUSMA (Canada–US–Mexico Agreement) — the Canadian-side
 *            counterpart of the US USMCA.
 * Scope: US- or Mexico-origin goods imported into Canada under CUSMA
 *        with certification on file.
 *
 * Sources:
 *   - ca.cbsa.cusma-implementation
 *   - 'Canada Customs Tariff — CUSMA preferential rates schedule'
 *
 * Plain-English summary:
 *   Replaces the base tariff with 0 for US/MX-origin goods that qualify
 *   under CUSMA. Does NOT exempt the §53 countermeasure rule (which is
 *   in the rule's own `isApplicable()` check via `cusma_qualifying`).
 *
 * Conflicts / stacking:
 *   - None declared. Countermeasure rule checks the qualifying flag
 *     internally.
 *
 * Last reviewed by counsel: PENDING (P6.T7)
 */
@Injectable()
export class CaCusmaQualifyingRule extends FtaQualifyingRuleBase {
  readonly id = 'ca.cusma.qualifying';
  readonly destination = 'CA';
  readonly agreementCode = 'CUSMA';
  readonly title = 'CUSMA — Qualifying preferential treatment (Canada)';
  readonly knowledgeCardKeys = [
    'ca.cbsa.cusma-implementation',
    'ca.customs-tariff.cusma-schedule',
  ];
  protected readonly qualifyingOrigins = new Set(['US', 'MX']);
}
