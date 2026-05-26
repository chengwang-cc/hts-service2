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
 * Rule: us.section232.steel-korea-quota
 * Authority: Section 232 of the Trade Expansion Act of 1962 + KORUS
 * Scope: Steel from KR origin, KR melt + pour, US destination, within
 *        the annual quota volume.
 *
 * Sources:
 *   - cbp.csms.62100021 — KR steel TRQ administration
 *   - fr.proclamation.9740 — KR quota deal
 *
 * Plain-English summary:
 *   Korea-origin steel with Korean melt + pour is exempt from the 25%
 *   Section 232 duty up to the annual quota volume (TRQ). Once the
 *   quota is exhausted, the standard 25% applies.
 *
 *   Quota tracking is NOT performed here — the rule emits the in-quota
 *   zero-duty line. Operators flag `steel_kr_quota_exhausted: true` on
 *   the line input when the calendar-year quota has filled to switch
 *   to the standard 25% path.
 *
 * Conflicts / stacking:
 *   - `conflictsWith: ['us.section232.steel-melt-pour']` — exempts the
 *     standard 25% from also firing.
 *
 * Last reviewed by counsel: PENDING (P3.T11)
 */
@Injectable()
export class Section232SteelKoreaQuotaRule implements ExceptionRule {
  readonly id = 'us.section232.steel-korea-quota';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'section_232';
  readonly title = 'Section 232 Steel — Korea TRQ in-quota exemption';
  readonly priority = 2105;
  readonly knowledgeCardKeys = ['cbp.csms.62100021', 'fr.proclamation.9740'];
  readonly conflictsWith = ['us.section232.steel-melt-pour'];

  constructor(private readonly scope: SteelScopeService) {}

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    if (ctx.origin !== 'KR') return false;
    if (!this.scope.isInScope(ctx.htsCode, ctx.asOfDate)) return false;
    const melt = up(ctx.additionalInputs['steel_melt_country']);
    const pour = up(ctx.additionalInputs['steel_pour_country']);
    if (melt !== 'KR' || pour !== 'KR') return false;
    const quotaExhausted = Boolean(
      ctx.additionalInputs['steel_kr_quota_exhausted'],
    );
    return !quotaExhausted;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'steel_kr_quota_exhausted',
        type: 'boolean',
        required: false,
        label: 'KR steel TRQ exhausted? (check if calendar-year quota is full)',
        helpRef: 'knowledge:cbp.csms.62100021#quota',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const removeKeys = ctx.pendingComponents
      .filter(isSplitterSteelRow)
      .map(componentKey);
    return {
      removeKeys,
      add: [
        makeSteelComponent({
          chapter99: '9903.80.61',
          formula: '0',
          rateLabel: 'Steel (Section 232 — KR in-quota exemption)',
          legalReference: 'Proc 9740; CSMS 62100021',
          description:
            'Section 232 steel from Korea within annual TRQ — zero additional duty.',
        }),
      ],
      notes: ['kr-quota in-quota branch'],
    };
  }
}
