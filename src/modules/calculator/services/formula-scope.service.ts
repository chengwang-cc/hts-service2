import { Injectable } from '@nestjs/common';
import { FormulaVariable } from './tariff-types';

@Injectable()
export class FormulaScopeService {
  buildBaseScope(input: {
    declaredValue?: number;
    weightKg?: number;
    quantity?: number;
    quantityUnit?: string;
    additionalInputs?: Record<string, any>;
  }): {
    value?: number;
    weight?: number;
    quantity?: number;
    additionalInputs: Record<string, any>;
  } {
    const additionalInputs = { ...(input.additionalInputs || {}) };
    const quantity = this.toFiniteNumber(input.quantity);
    const quantityUnit = input.quantityUnit || additionalInputs.quantityUnit;

    if (quantity !== null) {
      this.addQuantityAliases(additionalInputs, quantity, quantityUnit);
    }
    const weight = this.toFiniteNumber(input.weightKg);
    if (weight !== null) {
      additionalInputs.weight_kg ??= weight;
      additionalInputs.weight_ton ??= weight / 1000;
    }

    return {
      value: this.toFiniteNumber(input.declaredValue) ?? undefined,
      weight: weight ?? undefined,
      quantity: quantity ?? undefined,
      additionalInputs,
    };
  }

  deriveDeclaredVariables(variables?: FormulaVariable[] | null): string[] {
    return Array.from(
      new Set((variables || []).map((v) => v.name).filter(Boolean)),
    );
  }

  private addQuantityAliases(
    additionalInputs: Record<string, any>,
    quantity: number,
    quantityUnit?: string,
  ) {
    const unit = this.normalizeUnit(quantityUnit);
    additionalInputs.quantity_each ??=
      unit === 'dozen'
        ? quantity * 12
        : unit === 'pair'
          ? quantity * 2
          : unit === 'gross'
            ? quantity * 144
            : quantity;
    additionalInputs.quantity_pair ??=
      unit === 'each'
        ? quantity / 2
        : unit === 'dozen'
          ? quantity * 6
          : quantity;
    additionalInputs.quantity_dozen ??=
      unit === 'each'
        ? quantity / 12
        : unit === 'pair'
          ? quantity / 6
          : quantity;
    additionalInputs.quantity_gross ??=
      unit === 'each' ? quantity / 144 : quantity;
    additionalInputs.quantity_set ??= quantity;
    additionalInputs.volume_liter ??=
      unit === 'liter' || unit === 'proof_liter' ? quantity : undefined;
    additionalInputs.proof_liter ??=
      unit === 'proof_liter' ? quantity : undefined;
    additionalInputs.volume_barrel ??= unit === 'barrel' ? quantity : undefined;
    additionalInputs.volume_m3 ??= unit === 'm3' ? quantity : undefined;
    additionalInputs.weight_ton ??= unit === 'ton' ? quantity : undefined;
    additionalInputs.area_m2 ??= unit === 'area_m2' ? quantity : undefined;
    additionalInputs.length_m ??= unit === 'length_m' ? quantity : undefined;
  }

  private normalizeUnit(unit?: string): string {
    const compact = (unit || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!compact) return 'each';
    if (
      [
        'ea',
        'each',
        'head',
        'heads',
        'unit',
        'units',
        'piece',
        'pieces',
        'item',
        'items',
      ].includes(compact)
    ) {
      return 'each';
    }
    if (['pr', 'pair', 'pairs'].includes(compact)) return 'pair';
    if (['doz', 'dozen'].includes(compact)) return 'dozen';
    if (['gross'].includes(compact)) return 'gross';
    if (['t', 'ton', 'tons', 'tonne', 'tonnes', 'metricton'].includes(compact))
      return 'ton';
    if (['bbl', 'barrel', 'barrels'].includes(compact)) return 'barrel';
    if (
      [
        'm3',
        'cbm',
        'cubicmeter',
        'cubicmeters',
        'cubicmetre',
        'cubicmetres',
      ].includes(compact)
    ) {
      return 'm3';
    }
    if (['l', 'liter', 'liters', 'litre', 'litres'].includes(compact)) {
      return 'liter';
    }
    if (
      ['proofliter', 'proofliters', 'pfliter', 'pfliters'].includes(compact)
    ) {
      return 'proof_liter';
    }
    if (['sqm', 'm2', 'squaremeter', 'squaremeters'].includes(compact)) {
      return 'area_m2';
    }
    if (['m', 'meter', 'meters'].includes(compact)) {
      return 'length_m';
    }
    return 'each';
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}
