export type FormulaAstNode =
  | { kind: 'constant'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'operator'; op: string; args: FormulaAstNode[] }
  | { kind: 'function'; name: string; args: FormulaAstNode[] }
  | { kind: 'raw'; expression: string };

export type FormulaComponentAst =
  | {
      kind: 'ad_valorem';
      rate: number;
      valueVariable: string;
    }
  | {
      kind: 'specific';
      amount: number;
      unitVariable: string;
      unitDimension: FormulaUnitDimension;
    }
  | {
      kind: 'compound';
      components: FormulaComponentAst[];
    }
  | {
      kind: 'minimum';
      amount: number;
      component: FormulaComponentAst;
    }
  | {
      kind: 'maximum';
      amount: number;
      component: FormulaComponentAst;
    }
  | {
      kind: 'conditional';
      condition: ConditionAstNode;
      whenTrue: FormulaComponentAst;
      whenFalse?: FormulaComponentAst;
    }
  | {
      kind: 'expression';
      formulaAst: FormulaAstNode;
    };

export type FormulaUnitDimension =
  | 'money'
  | 'weight'
  | 'quantity'
  | 'volume'
  | 'area'
  | 'length';

export type CalculationStage =
  | 'base'
  | 'additional_duty'
  | 'post_calculation_fee'
  | 'tax'
  | 'adjustment'
  | 'exemption';

export type RoundingPolicy = {
  mode: 'component_2dp' | 'defer' | 'final_2dp';
  precision?: number;
  jurisdictionCode?: string;
};

export type ConditionAstNode =
  | { kind: 'always' }
  | { kind: 'all'; conditions: ConditionAstNode[] }
  | { kind: 'any'; conditions: ConditionAstNode[] }
  | { kind: 'not'; condition: ConditionAstNode }
  | { kind: 'country_in'; countries: string[] }
  | { kind: 'country_not_in'; countries: string[] }
  | { kind: 'chapter99_selected'; heading: string }
  | { kind: 'chapter99_not_selected'; heading: string }
  | { kind: 'declared_value_min'; value: number }
  | { kind: 'declared_value_max'; value: number }
  | { kind: 'trade_agreement'; agreement: string; requiresCertificate: boolean }
  | { kind: 'additional_input_flag'; key: string; expected: boolean }
  | { kind: 'mode_of_transport'; mode: string }
  | { kind: 'manual_review_required'; reason?: string };

export type FormulaValidationStatus =
  | 'pending'
  | 'valid'
  | 'invalid'
  | 'needs_review';

export interface FormulaTestVector {
  name: string;
  inputs: Record<string, number>;
  expectedAmount: number;
  tolerance?: number;
}

export interface FormulaConstructionArtifact {
  formulaText: string;
  formulaAst: FormulaAstNode;
  formulaCanonical: string;
  formulaSemanticHash: string;
  componentAst?: FormulaComponentAst;
  conditionAst: ConditionAstNode;
  unitDimensions: Record<string, FormulaUnitDimension | string>;
  calculationStage: CalculationStage;
  roundingPolicy: RoundingPolicy;
  constraints: {
    minAmount?: number | null;
    maxAmount?: number | null;
  };
  parserName: string;
  parserVersion: string;
  validationStatus: FormulaValidationStatus;
  validationErrors: string[];
  testVectors: FormulaTestVector[];
}
