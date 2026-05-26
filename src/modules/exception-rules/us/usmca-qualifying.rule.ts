import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import { componentKey } from '../exception-rule-runner.service';

/**
 * Rule: us.usmca.qualifying
 * Authority: USMCA (United States-Mexico-Canada Agreement)
 * Scope: Goods of MX or CA origin into the US claiming USMCA
 *        preferential treatment with a certification of origin on file.
 *
 * Sources:
 *   - usitc.note.usmca
 *   - cbp.publication.usmca-cbp
 *   - 19 USC §4501 et seq.
 *
 * Plain-English summary:
 *   When goods qualify under USMCA AND a certification is on file,
 *   the base ad valorem duty is zero. The IEEPA fentanyl-MX and -CA
 *   rules already check `usmca_qualifying` and exempt themselves —
 *   this rule covers the base-rate zeroing.
 *
 *   Important: USMCA does NOT exempt §232 (steel/aluminum/autos) or
 *   §301-style remedies — those remain when applicable.
 *
 * Conflicts / stacking:
 *   - None declared. The fentanyl rules check the same input flag
 *     independently in their own `isApplicable()`.
 *
 * Last reviewed by counsel: PENDING (P4.T9)
 */
@Injectable()
export class UsmcaQualifyingRule implements ExceptionRule {
  readonly id = 'us.usmca.qualifying';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'special';
  readonly title = 'USMCA — Qualifying preferential treatment';
  readonly priority = 6000;
  readonly knowledgeCardKeys = [
    'usitc.note.usmca',
    'cbp.publication.usmca-cbp',
  ];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    if (ctx.origin !== 'MX' && ctx.origin !== 'CA') return false;
    return Boolean(ctx.additionalInputs['usmca_qualifying']);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'usmca_qualifying',
        type: 'boolean',
        required: false,
        label: 'USMCA-qualifying (certificate of origin on file)?',
        helpRef: 'knowledge:cbp.publication.usmca-cbp',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const baseRows = ctx.pendingComponents.filter(isBaseLike);
    if (baseRows.length === 0) return {};

    const replaced: TariffFormulaComponent = {
      ...baseRows[0],
      formula: '0',
      rateText: 'USMCA — qualifying preferential treatment (0%)',
      description: 'Goods qualify under USMCA with certificate of origin on file.',
      identifier: 'USMCA_QUALIFYING',
      programFamily: 'special',
      programAuthority: 'USMCA (United States-Mexico-Canada Agreement)',
      legalReference: '19 USC §4501; USMCA Annex 4-B',
    };

    return {
      replace: [{ key: componentKey(baseRows[0]), with: replaced }],
      removeKeys: baseRows.slice(1).map(componentKey),
      notes: ['usmca qualifying preferential treatment'],
    };
  }
}

function isBaseLike(c: TariffFormulaComponent): boolean {
  const t = c.componentType;
  return t === 'base' || t === 'special' || t === 'non_ntr';
}

