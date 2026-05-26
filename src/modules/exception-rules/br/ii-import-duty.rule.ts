import { Injectable } from '@nestjs/common';
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
 * Rule: br.ii.import-duty — Brazilian Import Tax (Imposto de Importação).
 * Federal-level customs duty. Rate is HS-driven via the Mercosur TEC.
 * Default placeholder 14% — production deployment needs OPS to ingest
 * CAMEX's TEC + ex-tarifário schedule.
 *
 * Native currency: BRL.
 */
@Injectable()
export class BrImportDutyRule implements ExceptionRule {
  readonly id = 'br.ii.import-duty';
  readonly destination = 'BR';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'Brazil — Import Tax (II)';
  readonly priority = 8000;
  readonly knowledgeCardKeys = ['br.camex.tec', 'br.receita.classif'];

  isApplicable(ctx: ExceptionRuleContext): boolean {
    return ctx.destination === 'BR';
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'br_ii_rate_override',
        type: 'percent',
        required: false,
        label: 'II rate (% — overrides TEC default)',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const notes: string[] = [];
    const [overrideRate, n] = parseNumericInputWithNote(
      'br_ii_rate_override',
      ctx.additionalInputs['br_ii_rate_override'],
      { min: 0, max: 100, defaultIfMissing: 14, fallback: 14 },
    );
    if (n) notes.push(n);
    const rate = overrideRate / 100;
    const amount = ctx.declaredValue * rate;
    return {
      add: [{
        componentType: 'post_tax',
        formula: `${amount}`,
        rateText: `${(rate * 100).toFixed(0)}% — Brazil II (Import Tax)`,
        description: 'Brazil Imposto de Importação (federal customs duty).',
        requiredVariables: [],
        identifier: 'BR_II_IMPORT_DUTY',
        programFamily: 'tax',
        programAuthority: 'CAMEX / Receita Federal',
        legalReference: 'Mercosur TEC',
        appliesWhen: { kind: 'always' },
        sourceCitation: { source: 'br.camex.tec', confidence: 1, parserMethod: 'manual' },
        confidence: 1,
      } as TariffFormulaComponent],
      notes,
      data: { rate, amount },
    };
  }
}
