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
 * Rule: us.chapter98.us-goods-returned
 * Authority: HTS Chapter 98 — US Goods Returned (9801.00.10)
 * Scope: Goods that meet the Chapter 98 subheading requirements with
 *        proper documentation on file.
 *
 * Sources:
 *   - usitc.note.9801   — HTS Chapter 98 Subchapter I, Note 1
 *   - cbp.publication.us-goods-returned
 *   - 19 CFR 10.1
 *
 * Plain-English summary:
 *   When the importer claims Chapter 98 (e.g., 9801.00.1010 for US
 *   goods returned without improvement) AND has the supporting
 *   documentation on file, the base ad valorem duty is zero. Some
 *   subheadings limit eligibility (e.g., 9802.00.40 for repairs).
 *
 *   Inputs:
 *     - `chapter98_subheading`: which 9801/9802 subheading is claimed
 *     - `chapter98_documentation_attached`: confirms documentation
 *
 *   The rule REPLACES the base component with `0`. It does not
 *   suppress Section 232/301/IEEPA — those still apply to qualifying
 *   Chapter 98 goods unless separately exempted.
 *
 * Conflicts / stacking:
 *   - None. Targeted component replacement, not a wholesale exemption.
 *
 * Last reviewed by counsel: PENDING (P4.T9)
 */
@Injectable()
export class Chapter98UsGoodsReturnedRule implements ExceptionRule {
  readonly id = 'us.chapter98.us-goods-returned';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'chapter_98';
  readonly title = 'Chapter 98 — US Goods Returned';
  readonly priority = 1000;
  readonly knowledgeCardKeys = [
    'usitc.note.9801',
    'cbp.publication.us-goods-returned',
  ];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    const sub = String(ctx.additionalInputs['chapter98_subheading'] ?? '');
    if (!sub) return false;
    const hasDoc = Boolean(ctx.additionalInputs['chapter98_documentation_attached']);
    return hasDoc && /^980[12]\.00\./.test(sub);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'chapter98_subheading',
        type: 'enum',
        required: false,
        label: 'Chapter 98 subheading claimed',
        helpRef: 'knowledge:usitc.note.9801',
        allowedValues: [
          '9801.00.10',
          '9801.00.20',
          '9801.00.25',
          '9802.00.40',
          '9802.00.50',
          '9802.00.60',
        ],
      },
      {
        name: 'chapter98_documentation_attached',
        type: 'boolean',
        required: false,
        label: 'Documentation on file? (required for Chapter 98 claim)',
        helpRef: 'knowledge:cbp.publication.us-goods-returned',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    // Replace any base/special/non_ntr component with a zeroed
    // chapter_98 component carrying the claimed subheading citation.
    const baseRows = ctx.pendingComponents.filter(isBaseLike);
    if (baseRows.length === 0) return {};

    const sub = String(ctx.additionalInputs['chapter98_subheading'] ?? '');
    const replaced: TariffFormulaComponent = {
      ...baseRows[0],
      componentType: 'chapter_98',
      formula: '0',
      rateText: `Chapter 98 (${sub}) — zero rate`,
      description: `Goods claimed under HTS subheading ${sub}; supporting documentation on file.`,
      identifier: `CH98_${sub.replace(/\./g, '')}`,
      chapter99HtsCode: null,
      programFamily: 'chapter_98',
      programAuthority: 'HTS Chapter 98',
      legalReference: `HTS ${sub}; 19 CFR 10.1`,
    };

    return {
      replace: [{ key: componentKey(baseRows[0]), with: replaced }],
      // Also drop any additional base rows (rare — but keeps display clean).
      removeKeys: baseRows.slice(1).map(componentKey),
      notes: [`chapter 98 claim under ${sub}`],
    };
  }
}

function isBaseLike(c: TariffFormulaComponent): boolean {
  const t = c.componentType;
  return t === 'base' || t === 'special' || t === 'non_ntr';
}

