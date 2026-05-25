import { Injectable } from '@nestjs/common';
import { create, all, MathJsInstance } from 'mathjs';
import { FormulaVariable } from './tariff-types';
import { FormulaAstNode } from './formula-construction.types';
export type { FormulaAstNode } from './formula-construction.types';

export interface FormulaSemantics {
  formula: string;
  formulaAst: FormulaAstNode;
  canonicalFormula: string;
  semanticHash: string;
  variables: string[];
  validationErrors: string[];
}

const DIMENSION_BY_VARIABLE: Record<string, string> = {
  value: 'money',
  duty: 'money',
  total: 'money',
  weight: 'weight',
  weight_kg: 'weight',
  weight_ton: 'weight',
  quantity: 'quantity',
  quantity_each: 'quantity',
  quantity_pair: 'quantity',
  quantity_dozen: 'quantity',
  quantity_set: 'quantity',
  quantity_gross: 'quantity',
  volume_liter: 'volume',
  proof_liter: 'volume',
  volume_barrel: 'volume',
  volume_m3: 'volume',
  area_m2: 'area',
  length_m: 'length',
};

@Injectable()
export class FormulaSemanticsService {
  private readonly math: MathJsInstance;

  constructor() {
    this.math = create(all);
  }

  analyze(
    formula: string,
    variables: FormulaVariable[] = [],
  ): FormulaSemantics {
    const variableNames = variables.map((v) => v.name).filter(Boolean);
    const validationErrors: string[] = [];

    let formulaAst: FormulaAstNode;
    try {
      const parsed = this.math.parse(formula);
      formulaAst = this.toAst(parsed);
    } catch (error: any) {
      formulaAst = { kind: 'raw', expression: formula };
      validationErrors.push(error?.message || 'Formula parse failed');
    }

    let canonicalFormula: string;
    try {
      canonicalFormula = this.canonicalize(formula);
    } catch (error: any) {
      canonicalFormula = this.normalizeRawFormula(formula);
      validationErrors.push(
        error?.message || 'Formula canonicalization failed',
      );
    }
    const referencedVariables = this.extractVariablesFromAst(formulaAst);
    for (const referenced of referencedVariables) {
      if (!this.isKnownVariable(referenced, variableNames)) {
        validationErrors.push(`Undeclared variable: ${referenced}`);
      }
    }

    return {
      formula,
      formulaAst,
      canonicalFormula,
      semanticHash: this.hash(
        `${canonicalFormula}|${referencedVariables.join(',')}`,
      ),
      variables: referencedVariables,
      validationErrors,
    };
  }

  variablesToDimensions(variables: FormulaVariable[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const variable of variables || []) {
      if (!variable?.name) continue;
      out[variable.name] =
        variable.dimension ||
        DIMENSION_BY_VARIABLE[variable.name] ||
        this.inferDimension(variable.name);
    }
    return out;
  }

  normalizeForSemanticComparison(formula: string | null): string | null {
    if (!formula) return null;
    try {
      return this.canonicalize(formula).toUpperCase();
    } catch {
      return formula
        .replace(/\s+/g, ' ')
        .replace(/\s*([()+\-*/=,:])\s*/g, '$1')
        .trim()
        .toUpperCase();
    }
  }

  private toAst(node: any): FormulaAstNode {
    switch (node?.type) {
      case 'ConstantNode':
        return { kind: 'constant', value: Number(node.value) };
      case 'SymbolNode':
        return { kind: 'variable', name: node.name };
      case 'OperatorNode': {
        let args = (node.args || []).map((arg: any) => this.toAst(arg));
        if ((node.op === '+' || node.op === '*') && args.length >= 2) {
          args = args.flatMap((arg) =>
            arg.kind === 'operator' && arg.op === node.op ? arg.args : [arg],
          );
          args.sort((a, b) => this.astKey(a).localeCompare(this.astKey(b)));
        }
        return { kind: 'operator', op: node.op, args };
      }
      case 'ParenthesisNode':
        return this.toAst(node.content);
      case 'FunctionNode':
        return {
          kind: 'function',
          name: String(node.name || '').toLowerCase(),
          args: (node.args || []).map((arg: any) => this.toAst(arg)),
        };
      default:
        return { kind: 'raw', expression: node?.toString?.() || '' };
    }
  }

  private canonicalize(formula: string): string {
    const parsed = this.math.parse(formula);
    return this.astToString(this.toAst(parsed));
  }

  private astToString(node: FormulaAstNode): string {
    switch (node.kind) {
      case 'constant':
        return Number.isInteger(node.value) ? `${node.value}` : `${node.value}`;
      case 'variable':
        return node.name;
      case 'operator':
        return `(${node.args.map((arg) => this.astToString(arg)).join(node.op)})`;
      case 'function':
        return `${node.name}(${node.args.map((arg) => this.astToString(arg)).join(',')})`;
      case 'raw':
      default:
        return this.normalizeRawFormula(node.expression);
    }
  }

  private normalizeRawFormula(formula: string): string {
    return String(formula || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([()+\-*/=,:])\s*/g, '$1')
      .trim();
  }

  private astKey(node: FormulaAstNode): string {
    return this.astToString(node);
  }

  private extractVariablesFromAst(node: FormulaAstNode): string[] {
    const out = new Set<string>();
    const visit = (n: FormulaAstNode) => {
      if (n.kind === 'variable') {
        out.add(n.name);
      } else if (n.kind === 'operator' || n.kind === 'function') {
        for (const child of n.args) visit(child);
      } else if (n.kind === 'raw') {
        for (const match of n.expression.matchAll(/\b[a-z_][a-z0-9_]*\b/gi)) {
          out.add(match[0]);
        }
      }
    };
    visit(node);
    return Array.from(out).sort();
  }

  private isKnownVariable(name: string, declared: string[]): boolean {
    return (
      declared.includes(name) ||
      Object.prototype.hasOwnProperty.call(DIMENSION_BY_VARIABLE, name)
    );
  }

  private inferDimension(name: string): string {
    if (name.includes('value') || name === 'duty' || name === 'total') {
      return 'money';
    }
    if (name.includes('weight')) return 'weight';
    if (name.includes('volume') || name.includes('liter')) return 'volume';
    if (name.includes('area')) return 'area';
    if (name.includes('length')) return 'length';
    return 'quantity';
  }

  private hash(value: string): string {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
