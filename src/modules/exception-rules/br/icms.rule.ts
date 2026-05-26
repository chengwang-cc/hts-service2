import { Injectable, Logger } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import { parseNumericInputWithNote } from '../_shared/numeric-input';

/**
 * Rule: br.icms.state-rate — Brazil ICMS state VAT.
 *
 * ICMS is a state-level tax with rates varying by destination state.
 * This rule reads `ctx.destinationSubdivision` (W0.5.T2) for the state
 * code (e.g., "SP", "RJ", "MG"). When the subdivision is missing, the
 * rule emits a user-facing warning + defaults to the federal-average
 * 18% — the operator should always supply the destination state for an
 * accurate quote.
 *
 * Native currency: BRL.
 *
 * Per-state rate map below is a starting point. OPS must replace with
 * a maintained per-state table (legal review per Decision #2 of the
 * source-of-truth plan).
 */
const STATE_RATES: Record<string, number> = {
  AC: 0.19, AL: 0.19, AP: 0.18, AM: 0.20, BA: 0.20, CE: 0.20,
  DF: 0.20, ES: 0.17, GO: 0.19, MA: 0.22, MT: 0.17, MS: 0.17,
  MG: 0.18, PA: 0.19, PB: 0.20, PR: 0.19, PE: 0.20, PI: 0.21,
  RJ: 0.22, RN: 0.18, RS: 0.17, RO: 0.19, RR: 0.20, SC: 0.17,
  SP: 0.18, SE: 0.22, TO: 0.20,
};

@Injectable()
export class BrIcmsRule implements ExceptionRule {
  private readonly logger = new Logger(BrIcmsRule.name);

  readonly id = 'br.icms.state-rate';
  readonly destination = 'BR';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'Brazil — ICMS (State VAT)';
  readonly priority = 8001; // After federal taxes (II/IPI/PIS/COFINS)
  readonly knowledgeCardKeys = ['br.estados.icms-rates'];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    return ctx.destination === 'BR';
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'br_destination_state',
        type: 'enum',
        required: false,
        label: 'Brazil destination state (2-letter ISO-3166-2)',
        allowedValues: Object.keys(STATE_RATES).join(','),
      },
      {
        name: 'br_icms_taxable_value',
        type: 'money',
        required: false,
        label: 'ICMS base (post gross-up)',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    // W0.5.T2: prefer the canonical subdivision field; accept the legacy
    // `br_destination_state` input as a fallback for callers that
    // haven't migrated.
    const stateFromContext = ctx.destinationSubdivision;
    const stateFromInput = ctx.additionalInputs['br_destination_state'];
    const state =
      (typeof stateFromContext === 'string' && stateFromContext.toUpperCase()) ||
      (typeof stateFromInput === 'string' && stateFromInput.toUpperCase()) ||
      null;

    let rate = 0.18; // federal-average fallback
    const useExplicitRate = !!(state && state in STATE_RATES);
    if (useExplicitRate) {
      rate = STATE_RATES[state as string];
    } else {
      notes.push(
        'br.icms: destination state missing — using 18% federal-average estimate. ' +
          'Supply destinationSubdivision (e.g., "SP", "RJ") or additionalInputs.br_destination_state for an accurate rate.',
      );
    }

    const [base, baseNote] = parseNumericInputWithNote(
      'br_icms_taxable_value',
      ctx.additionalInputs['br_icms_taxable_value'],
      { min: 0, defaultIfMissing: ctx.declaredValue, fallback: 0 },
    );
    if (baseNote) notes.push(baseNote);

    const amount = base * rate;
    return {
      add: [{
        componentType: 'post_tax',
        formula: `${amount}`,
        rateText: `${(rate * 100).toFixed(0)}% — ICMS${useExplicitRate ? ` (${state})` : ' (estimate)'}`,
        description: useExplicitRate
          ? `Brazil ICMS @ ${(rate * 100).toFixed(0)}% for state ${state}`
          : `Brazil ICMS @ ${(rate * 100).toFixed(0)}% (federal-average estimate — state not supplied or unknown)`,
        requiredVariables: [
          { name: 'br_icms_taxable_value', type: 'number', dimension: 'money' },
        ],
        identifier: `BR_ICMS${useExplicitRate ? `_${state}` : '_ESTIMATE'}`,
        programFamily: 'tax',
        programAuthority: 'State Tax Authority (varies)',
        legalReference: 'Per-state ICMS legislation',
        appliesWhen: { kind: 'always' },
        sourceCitation: {
          source: 'br.estados.icms-rates',
          confidence: useExplicitRate ? 1 : 0.5,
          parserMethod: 'manual',
        },
        confidence: useExplicitRate ? 1 : 0.5,
      } as TariffFormulaComponent],
      notes,
      data: { rate, state, base, amount, stateProvided: useExplicitRate },
    };
  }
}
