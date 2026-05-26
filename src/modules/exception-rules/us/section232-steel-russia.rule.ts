import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
} from '../types';
import { SteelScopeService } from './helpers/steel-scope.service';
import {
  isSplitterSteelRow,
  makeSteelComponent,
  up,
} from './section232-steel-melt-pour.rule';
import { componentKey } from '../exception-rule-runner.service';

/**
 * Rule: us.section232.steel-russia
 * Authority: Section 232 of the Trade Expansion Act of 1962
 * Scope: Steel-scope HTS into US where Country of Melt or Pour is RU.
 *
 * Sources:
 *   - cbp.csms.59123456 — Russia steel derivative 200% rule
 *   - fr.proclamation.10522 — March 2024 Russia steel expansion
 *
 * Plain-English summary:
 *   When the steel content's country of melt or pour is Russia,
 *   apply 200% under Chapter 99 9903.80.03 instead of the standard 25%.
 *
 * Conflicts / stacking:
 *   - `conflictsWith: ['us.section232.steel-melt-pour']` — the standard
 *     25% rule short-circuits when melt/pour is RU, but this declaration
 *     prevents double-counting if rule order or future edits ever cause
 *     both to fire.
 *
 * Last reviewed by counsel: PENDING (P3.T11)
 */
@Injectable()
export class Section232SteelRussiaRule implements ExceptionRule {
  readonly id = 'us.section232.steel-russia';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'section_232';
  readonly title = 'Section 232 Steel — Russia 200%';
  readonly priority = 2110;
  readonly knowledgeCardKeys = [
    'cbp.csms.59123456',
    'fr.proclamation.10522',
  ];
  readonly conflictsWith = ['us.section232.steel-melt-pour'];

  constructor(private readonly scope: SteelScopeService) {}

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    if (!this.scope.isInScope(ctx.htsCode, ctx.asOfDate)) return false;
    const melt = up(ctx.additionalInputs['steel_melt_country']);
    const pour = up(ctx.additionalInputs['steel_pour_country']);
    return melt === 'RU' || pour === 'RU';
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return []; // reuses the melt/pour rule's inputs; no extras
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const removeKeys = ctx.pendingComponents
      .filter(isSplitterSteelRow)
      .map(componentKey);
    return {
      removeKeys,
      add: [
        makeSteelComponent({
          chapter99: '9903.80.03',
          formula: 'steel_value * 2.00',
          rateLabel: 'Steel (Section 232, 200% — Russia melt/pour)',
          legalReference: 'CSMS 59123456; Proc 10522',
          description:
            'Section 232 steel with Russian country of melt or pour — 200% additional duty.',
        }),
      ],
      notes: ['russia branch'],
    };
  }
}
