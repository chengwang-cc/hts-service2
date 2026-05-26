import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import { Section301ListLoader } from './helpers/section301-list-loader';

/**
 * Rule: us.section301.exclusions
 * Authority: Section 301 + USTR exclusion grants
 * Scope: any HTS with an active USTR Section 301 exclusion at asOfDate.
 *
 * Sources: USTR exclusion database; per-grant Federal Register notices.
 *
 * Plain-English summary:
 *   USTR grants product-specific exclusions from the §301 duties. When
 *   a granted exclusion is active for the HTS, this rule emits a
 *   NEGATIVE component that zeroes out the §301 list rule's
 *   contribution (matched by stable component key).
 *
 *   When multiple exclusions match (rare), each emits a row; the
 *   downstream evaluator sums them.
 *
 * Conflicts / stacking:
 *   - Runs AFTER all §301 list rules (priority 4700 vs 25xx). Pure
 *     additive negative contribution.
 *
 * Last reviewed by counsel: PENDING (P3.T11)
 */
@Injectable()
export class Section301ExclusionsRule implements ExceptionRule {
  readonly id = 'us.section301.exclusions';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'exclusion';
  readonly title = 'Section 301 — USTR product exclusions';
  /** Exclusions priority band (per design doc §3.4). */
  readonly priority = 4700;
  readonly knowledgeCardKeys = ['ustr.section301.exclusions-database'];

  constructor(private readonly loader: Section301ListLoader) {}

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    if (ctx.origin !== 'CN') return false;
    return this.loader.lookupExclusions(ctx.htsCode, ctx.asOfDate).length > 0;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const matches = this.loader.lookupExclusions(ctx.htsCode, ctx.asOfDate);
    if (matches.length === 0) return {};

    // Find any §301 list component already in pendingComponents — we
    // need to offset by its negative.
    const s301Rows = ctx.pendingComponents.filter(
      (c) => c.programFamily === 'section_301',
    );
    if (s301Rows.length === 0) {
      // Exclusion matches but no §301 line was emitted (perhaps because
      // the list rule is disabled). Don't emit a phantom negative.
      return { notes: ['exclusion matched but no §301 line present'] };
    }

    const adds: TariffFormulaComponent[] = [];
    for (const exclusion of matches) {
      for (const row of s301Rows) {
        // Mirror the §301 component but negate the formula and tag as
        // an exclusion component for clarity in the breakdown.
        adds.push({
          componentType: 'chapter_99',
          formula: `-(${row.formula})`,
          rateText: `Exclusion (${exclusion.exclusionCode})`,
          description: `USTR exclusion ${exclusion.exclusionCode} — offsets ${row.identifier}`,
          requiredVariables: row.requiredVariables,
          identifier: `S301_EXCLUSION_${exclusion.exclusionCode.replace(/\./g, '')}`,
          chapter99HtsCode: exclusion.exclusionCode,
          programFamily: 'exclusion',
          programAuthority: 'USTR Section 301 product exclusion',
          legalReference: exclusion.source,
          appliesWhen: row.appliesWhen,
          sourceCitation: {
            source: 'USTR Section 301 exclusions',
            rowIdentifier: exclusion.exclusionCode,
            confidence: 1,
            parserMethod: 'manual',
          },
          confidence: 1,
        });
      }
    }
    return { add: adds, notes: [`${matches.length} exclusion(s) matched`] };
  }
}
