import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import {
  Section301ListId,
  Section301ListLoader,
} from './helpers/section301-list-loader';
import { componentKey } from '../exception-rule-runner.service';

/**
 * Shared scaffold for the four Section 301 list rules
 * (1, 2, 3, 4A). Each concrete rule subclasses this and passes its
 * `listId`, priority, title, and knowledge-card keys.
 *
 * Applicability check: HTS is in the list at asOfDate AND destination
 * is US AND origin is CN (Section 301 China lists target CN origin).
 *
 * Stacking: the rule sets `programFamily: 'section_301'` so when the
 * resolver-side seed already emits a §301 line (legacy path), the new
 * rule's `removeKeys` drops it to avoid double-counting. Identifier
 * shape: `S301_LIST{1|2|3|4A}_{chapter99-no-dots}`.
 */
export abstract class Section301ListRuleBase implements ExceptionRule {
  abstract readonly id: string;
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'section_301';
  abstract readonly title: string;
  abstract readonly priority: number;
  abstract readonly knowledgeCardKeys: string[];
  protected abstract readonly listId: Section301ListId;

  constructor(protected readonly loader: Section301ListLoader) {}

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    if (ctx.origin !== 'CN') return false;
    return !!this.loader.lookup(this.listId, ctx.htsCode, ctx.asOfDate);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const entry = this.loader.lookup(this.listId, ctx.htsCode, ctx.asOfDate);
    if (!entry) return {};
    // Drop any pre-existing §301 row the resolver/seed emitted to avoid
    // double-counting.
    const removeKeys = ctx.pendingComponents
      .filter(isExistingSection301Row)
      .map(componentKey);
    return {
      removeKeys,
      add: [
        {
          componentType: 'chapter_99',
          formula: `value * ${entry.rate}`,
          rateText: `${(entry.rate * 100).toFixed(2)}% (Section 301 List ${this.listId})`,
          description: `Section 301 List ${this.listId} additional duty on Chinese-origin goods`,
          requiredVariables: [
            { name: 'value', type: 'number', dimension: 'money' },
          ],
          identifier: `S301_LIST${this.listId}_${entry.chapter99.replace(/\./g, '')}`,
          chapter99HtsCode: entry.chapter99,
          programFamily: 'section_301',
          programAuthority: 'Section 301 of the Trade Act of 1974',
          legalReference: entry.source,
          appliesWhen: { kind: 'country_in', countries: ['CN'] },
          sourceCitation: {
            source: `USTR Section 301 List ${this.listId}`,
            rowIdentifier: entry.chapter99,
            confidence: 1,
            parserMethod: 'manual',
          },
          confidence: 1,
        },
      ],
      notes: [`list ${this.listId} matched ${entry.chapter99}`],
    };
  }
}

function isExistingSection301Row(c: TariffFormulaComponent): boolean {
  return c.programFamily === 'section_301';
}

