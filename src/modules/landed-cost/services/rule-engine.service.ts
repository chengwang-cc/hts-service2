import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Or, IsNull, Repository } from 'typeorm';
import { FormulaEvaluationService } from '../../calculator/services/formula-evaluation.service';
import {
  FeeRuleEntity,
  LowValueRuleEntity,
  TaxRuleEntity,
} from '../../jurisdiction/entities';

/**
 * RuleEngineService (P4.2)
 *
 * Generic engine that loads jurisdiction TaxRule / FeeRule /
 * LowValueRule rows and evaluates them against a calculation context.
 * Supports the rule forms enumerated in the execution plan:
 *   - ad valorem (rate*base)
 *   - specific (mathjs formula referencing weight/quantity)
 *   - compound (formula sum)
 *   - selective/greater-of/lesser-of (formula with min/max)
 *   - min/max caps (FeeRuleEntity.minAmount/maxAmount)
 *   - thresholds (LowValueRuleEntity)
 *   - taxes on correct base (TaxRuleEntity.baseFormula)
 */
@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);

  constructor(
    @InjectRepository(FeeRuleEntity)
    private readonly feeRepo: Repository<FeeRuleEntity>,
    @InjectRepository(TaxRuleEntity)
    private readonly taxRepo: Repository<TaxRuleEntity>,
    @InjectRepository(LowValueRuleEntity)
    private readonly lvRepo: Repository<LowValueRuleEntity>,
    private readonly evaluator: FormulaEvaluationService,
  ) {}

  /**
   * Resolve the active low-value rule for a jurisdiction on a given
   * effectiveDate. Returns null when none applies.
   */
  async findActiveLowValueRule(
    jurisdictionCode: string,
    effectiveDate: string,
  ): Promise<LowValueRuleEntity | null> {
    return this.lvRepo
      .createQueryBuilder('lv')
      .where('lv.jurisdictionCode = :j', {
        j: jurisdictionCode.toUpperCase(),
      })
      .andWhere('lv.effectiveFrom <= :d', { d: effectiveDate })
      .andWhere('(lv.effectiveTo IS NULL OR lv.effectiveTo >= :d)', {
        d: effectiveDate,
      })
      .orderBy('lv.effectiveFrom', 'DESC')
      .limit(1)
      .getOne();
  }

  async evaluateFees(args: {
    jurisdictionCode: string;
    effectiveDate: string;
    variables: { value: number; weight: number; quantity: number; duty: number; total: number };
    transportMode?: string;
    declarationType?: string;
  }): Promise<Array<{ ruleId: string; feeType: string; name: string; amount: number; warnings: string[] }>> {
    const candidates = await this.feeRepo
      .createQueryBuilder('f')
      .where('f.jurisdictionCode = :j', {
        j: args.jurisdictionCode.toUpperCase(),
      })
      .andWhere('f.effectiveFrom <= :d', { d: args.effectiveDate })
      .andWhere('(f.effectiveTo IS NULL OR f.effectiveTo >= :d)', {
        d: args.effectiveDate,
      })
      .getMany();

    const out: Array<{
      ruleId: string;
      feeType: string;
      name: string;
      amount: number;
      warnings: string[];
    }> = [];

    for (const rule of candidates) {
      if (
        rule.transportMode &&
        args.transportMode &&
        rule.transportMode !== args.transportMode
      ) {
        continue;
      }
      if (
        rule.declarationType &&
        args.declarationType &&
        rule.declarationType !== args.declarationType
      ) {
        continue;
      }
      if (
        rule.thresholdAmount &&
        args.variables.value < Number(rule.thresholdAmount)
      ) {
        continue;
      }

      let amount = 0;
      const warnings: string[] = [];
      try {
        amount = this.evaluator.evaluate(rule.formula, args.variables);
      } catch (e: any) {
        warnings.push(`fee_formula_failed: ${e?.message}`);
        continue;
      }
      if (rule.minAmount !== null && rule.minAmount !== undefined) {
        amount = Math.max(amount, Number(rule.minAmount));
      }
      if (rule.maxAmount !== null && rule.maxAmount !== undefined) {
        amount = Math.min(amount, Number(rule.maxAmount));
      }
      if (amount > 0) {
        out.push({
          ruleId: rule.id,
          feeType: rule.feeType,
          name: rule.name,
          amount: this.round2(amount),
          warnings,
        });
      }
    }
    return out;
  }

  async evaluateTaxes(args: {
    jurisdictionCode: string;
    memberStateCode?: string;
    effectiveDate: string;
    variables: { value: number; weight: number; quantity: number; duty: number; total: number };
  }): Promise<Array<{ ruleId: string; taxType: string; name: string; amount: number; warnings: string[] }>> {
    const memberStateClause = args.memberStateCode
      ? '(t.memberStateCode = :ms OR t.memberStateCode IS NULL)'
      : 't.memberStateCode IS NULL';
    const params: any = { j: args.jurisdictionCode.toUpperCase(), d: args.effectiveDate };
    if (args.memberStateCode) params.ms = args.memberStateCode.toUpperCase();

    const candidates = await this.taxRepo
      .createQueryBuilder('t')
      .where('t.jurisdictionCode = :j')
      .andWhere(memberStateClause)
      .andWhere('t.effectiveFrom <= :d')
      .andWhere('(t.effectiveTo IS NULL OR t.effectiveTo >= :d)')
      .setParameters(params)
      .getMany();

    const out: Array<{
      ruleId: string;
      taxType: string;
      name: string;
      amount: number;
      warnings: string[];
    }> = [];

    for (const rule of candidates) {
      if (rule.collectionPoint === 'exempt') continue;
      let amount = 0;
      const warnings: string[] = [];
      try {
        if (rule.baseFormula) {
          amount = this.evaluator.evaluate(rule.baseFormula, args.variables);
        } else {
          amount = args.variables.total * Number(rule.rate);
        }
      } catch (e: any) {
        warnings.push(`tax_formula_failed: ${e?.message}`);
        continue;
      }
      if (amount > 0) {
        out.push({
          ruleId: rule.id,
          taxType: rule.taxType,
          name: rule.name,
          amount: this.round2(amount),
          warnings,
        });
      }
    }
    return out;
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }
}
