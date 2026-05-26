import type {
  ProgramFamily,
  TariffFormulaComponent,
} from '../../types';

/**
 * Shared component-construction helper for US exception rules.
 * Keeps every emitted component consistent and reduces boilerplate.
 *
 * Each call returns a self-contained `TariffFormulaComponent` that
 * carries: Chapter 99 attribution, identifier, program family, source
 * citation, and a confidence of 1 (these are typed rule outputs, not
 * heuristics).
 */
export interface MakeComponentArgs {
  chapter99: string;
  formula: string;
  rateLabel: string;
  identifier: string;
  programFamily: ProgramFamily;
  programAuthority: string;
  legalReference: string;
  description: string;
  /** Source citation label shown in the audit pane. */
  sourceLabel: string;
  /** Required variables for the formula (defaults to `value`). */
  requiredVariables?: TariffFormulaComponent['requiredVariables'];
  /**
   * Override the appliesWhen condition. Defaults to `{ kind: 'always' }`
   * since rules' own `isApplicable()` gates them at runtime.
   */
  appliesWhen?: TariffFormulaComponent['appliesWhen'];
}

export function makeComponent(args: MakeComponentArgs): TariffFormulaComponent {
  return {
    componentType: 'chapter_99',
    formula: args.formula,
    rateText: args.rateLabel,
    description: args.description,
    requiredVariables: args.requiredVariables ?? [
      { name: 'value', type: 'number', dimension: 'money' },
    ],
    identifier: args.identifier,
    chapter99HtsCode: args.chapter99,
    programFamily: args.programFamily,
    programAuthority: args.programAuthority,
    legalReference: args.legalReference,
    appliesWhen: args.appliesWhen ?? { kind: 'always' },
    sourceCitation: {
      source: args.sourceLabel,
      rowIdentifier: args.chapter99,
      confidence: 1,
      parserMethod: 'manual',
    },
    confidence: 1,
  };
}

