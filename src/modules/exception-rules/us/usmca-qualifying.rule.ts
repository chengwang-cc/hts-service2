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

  /**
   * 2026-05-27: scope-only check — destination US + origin in MX/CA.
   * Independent of the user-set `usmca_qualifying` flag, so the
   * formula endpoint can surface this rule's input even before the
   * user has touched anything (otherwise the flag input never renders
   * for new users — see `tariff-rate-batch.collectRuleInputs`).
   */
  isInScope(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    return ctx.origin === 'MX' || ctx.origin === 'CA';
  }

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (!this.isInScope(ctx)) return false;
    return Boolean(ctx.additionalInputs['usmca_qualifying']);
  }

  declaredInputs(ctx?: ExceptionRuleContext): ExceptionRuleInputSpec[] {
    // Pre-check the flag when origin is MX or CA — most shipments
    // from those countries to the US legitimately qualify under
    // USMCA. User can uncheck if their goods don't meet rules of
    // origin (e.g. CN-yarn apparel finished in MX).
    const originQualifies = ctx?.origin
      ? ctx.origin === 'MX' || ctx.origin === 'CA'
      : undefined;
    return [
      {
        name: 'usmca_qualifying',
        type: 'boolean',
        required: false,
        label: 'USMCA-qualifying (certificate of origin on file)?',
        helpRef: 'knowledge:cbp.publication.usmca-cbp',
        defaultValue: originQualifies,
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

