import { Injectable, Logger } from '@nestjs/common';
import { create, all, MathJsInstance } from 'mathjs';
import { FormulaGenerationService } from '@hts/core';

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
    variables: {
      value?: number;
      weight?: number;
      quantity?: number;
      duty?: number;
      total?: number;
      [key: string]: number | undefined;
    },
  ): number {
    try {
      const validation = this.formulaGenerationService.validateFormula(formula);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid formula');
      }

      const scope: Record<string, number> = {};

      Object.keys(variables).forEach((key) => {
        if (variables[key] !== undefined) {
          scope[key] = variables[key]!;
        }
      });

      const result = this.math.evaluate(formula, scope);

      if (typeof result === 'number') {
        return this.roundToTwoDecimals(result);
      }

      throw new Error(`Formula evaluation returned non-numeric result`);
    } catch (error) {
      this.logger.error(`Formula evaluation failed: ${error.message}`);
      throw new Error(`Formula evaluation error: ${error.message}`);
    }
  }

  private roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
