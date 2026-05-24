import { Injectable, Logger } from '@nestjs/common';
import { create, all, MathJsInstance } from 'mathjs';
import { FormulaGenerationService } from '@hts/core';

const SYSTEM_VARIABLES = new Set([
  'value',
  'weight',
  'quantity',
  'duty',
  'total',
]);

export class UndeclaredFormulaVariableError extends Error {
  readonly code = 'UNDECLARED_FORMULA_VARIABLE';
  constructor(public readonly variableNames: string[]) {
    super(
      `Undeclared formula variable(s): ${variableNames.join(', ')}`,
    );
  }
}

export interface FormulaEvaluationVariables {
  value?: number;
  weight?: number;
  quantity?: number;
  duty?: number;
  total?: number;
  /**
   * Type-coerced additional inputs. Only keys present in
   * `declaredVariables` are added to the evaluation scope; anything else
   * is rejected with UndeclaredFormulaVariableError.
   */
  additionalInputs?: Record<string, unknown>;
  /**
   * Allowlist of variable names the formula is permitted to read beyond
   * the built-in `value/weight/quantity/duty/total` set. Pulled from the
   * resolver's component.requiredVariables.
   */
  declaredVariables?: string[];
}

@Injectable()
export class FormulaEvaluationService {
  private readonly logger = new Logger(FormulaEvaluationService.name);
  private readonly math: MathJsInstance;

  constructor(
    private readonly formulaGenerationService: FormulaGenerationService,
  ) {
    this.math = create(all);
  }

  evaluate(
    formula: string,
    variables: FormulaEvaluationVariables | Record<string, unknown>,
  ): number {
    try {
      const validation = this.formulaGenerationService.validateFormula(formula);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid formula');
      }

      const scope = this.buildScope(formula, variables);
      const result = this.math.evaluate(formula, scope);

      if (typeof result === 'number') {
        return this.roundToTwoDecimals(result);
      }

      throw new Error(`Formula evaluation returned non-numeric result`);
    } catch (error) {
      if (error instanceof UndeclaredFormulaVariableError) {
        this.logger.warn(
          `Rejected formula "${formula}": ${error.message}`,
        );
        throw error;
      }
      this.logger.error(
        `Formula evaluation failed for "${formula}": ${(error as Error).message}`,
      );
      throw new Error(
        `Formula evaluation error: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Builds the variable scope for mathjs evaluation. System variables
   * (value/weight/quantity/duty/total) are always allowed. Additional
   * inputs are only added if their name appears in `declaredVariables`,
   * which comes from the resolver's component.requiredVariables.
   *
   * Backwards-compatible: callers that pass a flat object (legacy shape)
   * are accepted by treating every numeric key as scope.
   */
  private buildScope(
    formula: string,
    variables: FormulaEvaluationVariables | Record<string, unknown>,
  ): Record<string, number> {
    const scope: Record<string, number> = {};
    const isStructured =
      variables &&
      typeof variables === 'object' &&
      ('additionalInputs' in variables ||
        'declaredVariables' in variables ||
        ('value' in variables ||
          'weight' in variables ||
          'quantity' in variables ||
          'duty' in variables ||
          'total' in variables));

    if (!isStructured) {
      // Legacy flat shape — copy every finite number.
      for (const [k, v] of Object.entries(variables || {})) {
        const n = this.coerceNumber(v);
        if (n !== null) scope[k] = n;
      }
      return scope;
    }

    const v = variables as FormulaEvaluationVariables;
    for (const key of SYSTEM_VARIABLES) {
      const n = this.coerceNumber((v as any)[key]);
      if (n !== null) scope[key] = n;
    }

    const declared = new Set<string>(v.declaredVariables || []);
    const additional = v.additionalInputs || {};
    const undeclared: string[] = [];

    for (const [key, raw] of Object.entries(additional)) {
      if (SYSTEM_VARIABLES.has(key)) continue;
      const n = this.coerceNumber(raw);
      if (n === null) continue;
      if (v.declaredVariables && !declared.has(key)) {
        // Only enforce when the caller passed an explicit allowlist.
        undeclared.push(key);
        continue;
      }
      scope[key] = n;
    }

    if (undeclared.length > 0) {
      // Only throw when an undeclared variable is actually referenced in
      // the formula — passing extra metadata should not break unrelated calls.
      const referenced = undeclared.filter((name) =>
        this.formulaReferencesIdentifier(formula, name),
      );
      if (referenced.length > 0) {
        throw new UndeclaredFormulaVariableError(referenced);
      }
    }

    return scope;
  }

  private formulaReferencesIdentifier(
    formula: string,
    identifier: string,
  ): boolean {
    const re = new RegExp(`\\b${this.escapeRegExp(identifier)}\\b`);
    return re.test(formula);
  }

  private escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private coerceNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
