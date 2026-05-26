import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';

/**
 * Rule: kr.education-tax (교육세)
 * Authority: 교육세법 (Education Tax Act)
 * Scope: Stacks on the KR Special Excise Tax — applies when a special
 *        excise component was already emitted for the same line.
 *
 * Sources:
 *   - kr.nts.education-tax-act
 *
 * Plain-English summary:
 *   30% of the Individual Consumption Tax (special excise) amount.
 *   The rule reads `pendingComponents` to find the special-excise
 *   amount (precomputed at runtime) and emits 30% of the formula.
 *
 * Conflicts / stacking:
 *   - Depends on kr.special-excise-tax firing first (priority 9000 < 9010).
 *   - Implementation: detects the special-excise component in
 *     `pendingComponents` by its programFamily + identifier and emits
 *     a derivative component referencing the same formula scaled by 0.3.
 *
 * Last reviewed by counsel: PENDING (P5.T12)
 */
@Injectable()
export class KrEducationTaxRule implements ExceptionRule {
  readonly id = 'kr.education-tax';
  readonly destination = 'KR';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'KR Education Tax (교육세)';
  readonly priority = 9010;
  readonly knowledgeCardKeys = ['kr.nts.education-tax-act'];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'KR') return false;
    return ctx.pendingComponents.some(isSpecialExciseRow);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const sources = ctx.pendingComponents.filter(isSpecialExciseRow);
    if (sources.length === 0) return {};
    const adds: TariffFormulaComponent[] = sources.map((src) => ({
      componentType: 'post_tax',
      formula: `(${src.formula}) * 0.30`,
      rateText: '30% of Special Excise (교육세)',
      description: `Education Tax (교육세) — 30% of ${src.identifier}.`,
      requiredVariables: src.requiredVariables,
      identifier: `KR_EDUCATION_TAX_${src.identifier}`,
      programFamily: 'tax',
      programAuthority: '교육세법 (Education Tax Act)',
      legalReference: 'KR NTS Education Tax Act',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'KR NTS — Education Tax',
        rowIdentifier: 'education-30pct',
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    }));
    return { add: adds, notes: [`${sources.length} special-excise source(s)`] };
  }
}

function isSpecialExciseRow(c: TariffFormulaComponent): boolean {
  if (c.programFamily !== 'tax') return false;
  const id = (c.identifier || '').toUpperCase();
  return id.startsWith('KR_ICTAX_');
}
