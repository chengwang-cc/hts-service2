import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalculationHistoryEntity, TradeAgreementEligibilityEntity } from '../entities';
import { RateRetrievalService } from './rate-retrieval.service';
import { FormulaEvaluationService } from './formula-evaluation.service';
import { HtsExtraTaxEntity } from '@hts/core';

export interface CalculationInput {
  htsNumber: string;
  countryOfOrigin: string;
  declaredValue: number;
  currency?: string;
  weightKg?: number;
  quantity?: number;
  quantityUnit?: string;
  organizationId: string;
  userId?: string;
  scenarioId?: string;
  tradeAgreementCode?: string;
  tradeAgreementCertificate?: boolean;
  htsVersion?: string;
}

export interface CalculationResult {
  calculationId: string;
  baseDuty: number;
  additionalTariffs: number;
  totalTaxes: number;
  totalDuty: number;
  landedCost: number;
  breakdown: any;
  formulaUsed: string;
  rateSource: string;
  confidence: number;
  tradeAgreementInfo?: {
    agreement: string;
    eligible: boolean;
    preferentialRate?: number;
    preferentialFormula?: string;
    requiresCertificate?: boolean;
  } | null;
}

@Injectable()
export class CalculationService {
  private readonly logger = new Logger(CalculationService.name);
  private readonly ENGINE_VERSION = '1.0.0';

  constructor(
    @InjectRepository(CalculationHistoryEntity)
    private readonly historyRepository: Repository<CalculationHistoryEntity>,
    @InjectRepository(HtsExtraTaxEntity)
    private readonly extraTaxRepository: Repository<HtsExtraTaxEntity>,
    @InjectRepository(TradeAgreementEligibilityEntity)
    private readonly tradeAgreementEligibilityRepository: Repository<TradeAgreementEligibilityEntity>,
    private readonly rateRetrievalService: RateRetrievalService,
    private readonly formulaEvaluationService: FormulaEvaluationService,
  ) {}

  async calculate(input: CalculationInput): Promise<CalculationResult> {
    const calculationId = this.generateCalculationId();

    try {
      const rateInfo = await this.rateRetrievalService.getRate(
        input.htsNumber,
        input.countryOfOrigin,
        input.htsVersion,
      );

      const baseVariables = {
        value: input.declaredValue,
        weight: input.weightKg,
        quantity: input.quantity,
      };

      // Check for trade agreement eligibility
      const tradeAgreementInfo = await this.checkTradeAgreement(input);

      // Use preferential rate if eligible, otherwise use standard rate
      let baseDuty: number;
      let formulaUsed: string;
      let rateSource: string;

      if (tradeAgreementInfo.eligible && tradeAgreementInfo.preferentialFormula) {
        baseDuty = this.formulaEvaluationService.evaluate(
          tradeAgreementInfo.preferentialFormula,
          baseVariables,
        );
        formulaUsed = tradeAgreementInfo.preferentialFormula;
        rateSource = `trade-agreement-${tradeAgreementInfo.agreement}`;
        this.logger.log(`Using preferential rate from ${tradeAgreementInfo.agreement}`);
      } else {
        baseDuty = this.formulaEvaluationService.evaluate(
          rateInfo.formula,
          baseVariables,
        );
        formulaUsed = rateInfo.formula;
        rateSource = rateInfo.source;
      }

      const variables = {
        ...baseVariables,
        duty: baseDuty,
        total: input.declaredValue + baseDuty,
      };

      const applyExtraTaxes = !rateInfo.overrideExtraTax;

      // Calculate additional tariffs (entity-driven)
      const additionalTariffs = applyExtraTaxes
        ? await this.calculateAdditionalTariffs(input, variables)
        : [];

      const totalAdditionalTariffs = additionalTariffs.reduce(
        (sum, t) => sum + t.amount,
        0,
      );

      // Calculate taxes (entity-driven)
      const taxes = applyExtraTaxes ? await this.calculateTaxes(input, variables) : [];

      const totalTaxes = taxes.reduce((sum, t) => sum + t.amount, 0);
      const totalDuty = baseDuty + totalAdditionalTariffs;
      const landedCost = input.declaredValue + totalDuty + totalTaxes;

      const result: CalculationResult = {
        calculationId,
        baseDuty: Math.round(baseDuty * 100) / 100,
        additionalTariffs: Math.round(totalAdditionalTariffs * 100) / 100,
        totalTaxes: Math.round(totalTaxes * 100) / 100,
        totalDuty: Math.round(totalDuty * 100) / 100,
        landedCost: Math.round(landedCost * 100) / 100,
        breakdown: {
          baseDuty: Math.round(baseDuty * 100) / 100,
          additionalTariffs,
          taxes,
          totalDuty: Math.round(totalDuty * 100) / 100,
          totalTax: Math.round(totalTaxes * 100) / 100,
          landedCost: Math.round(landedCost * 100) / 100,
        },
        formulaUsed,
        rateSource,
        confidence: rateInfo.confidence,
        tradeAgreementInfo: tradeAgreementInfo.eligible ? tradeAgreementInfo : null,
      };

      await this.saveCalculationHistory(input, result);

      return result;
    } catch (error) {
      this.logger.error(`Calculation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculate additional tariffs (entity-driven)
   * Examples: Section 301, IEEPA, Chapter 99
   */
  private async calculateAdditionalTariffs(
    input: CalculationInput,
    variables: Record<string, any>,
  ): Promise<Array<{ type: string; amount: number; description: string }>> {
    const chapter = input.htsNumber.substring(0, 2);
    const now = new Date();

    // Query for all active ADD_ON tariffs
    const allTariffs = await this.extraTaxRepository.find({
      where: {
        isActive: true,
        extraRateType: 'ADD_ON',
      },
      order: {
        priority: 'ASC',
      },
    });

    const results: Array<{ type: string; amount: number; description: string }> = [];

    for (const tariff of allTariffs) {
      // Check if tariff applies to this HTS code
      const htsMatches =
        !tariff.htsNumber ||
        tariff.htsNumber === '*' ||
        tariff.htsNumber === input.htsNumber ||
        (tariff.htsChapter && tariff.htsChapter === chapter);

      if (!htsMatches) continue;

      // Check country code match
      const countryMatches =
        tariff.countryCode === 'ALL' ||
        tariff.countryCode === input.countryOfOrigin;

      if (!countryMatches) continue;

      // Check effective/expiration dates
      if (tariff.effectiveDate && tariff.effectiveDate > now) continue;
      if (tariff.expirationDate && tariff.expirationDate < now) continue;

      // Evaluate formula
      if (tariff.rateFormula) {
        try {
          const amount = this.formulaEvaluationService.evaluate(
            tariff.rateFormula,
            variables,
          );

          results.push({
            type: tariff.taxCode,
            amount: Math.round(amount * 100) / 100,
            description: tariff.description || tariff.taxName,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to evaluate tariff formula for ${tariff.taxCode}: ${error.message}`,
          );
        }
      }
    }

    return results;
  }

  /**
   * Calculate taxes (entity-driven)
   * Examples: MPF, HMF
   */
  private async calculateTaxes(
    input: CalculationInput,
    variables: Record<string, any>,
  ): Promise<Array<{ type: string; amount: number; description: string }>> {
    const now = new Date();
    const chapter = input.htsNumber.substring(0, 2);

    // Query for all active POST_CALCULATION taxes
    const allTaxes = await this.extraTaxRepository.find({
      where: {
        isActive: true,
        extraRateType: 'POST_CALCULATION',
      },
      order: {
        priority: 'ASC',
      },
    });

    const results: Array<{ type: string; amount: number; description: string }> = [];

    for (const tax of allTaxes) {
      // Check if tax applies to this HTS code
      const htsMatches =
        !tax.htsNumber ||
        tax.htsNumber === '*' ||
        tax.htsNumber === input.htsNumber ||
        (tax.htsChapter && tax.htsChapter === chapter);

      if (!htsMatches) continue;

      // Check country code match
      const countryMatches =
        tax.countryCode === 'ALL' ||
        tax.countryCode === input.countryOfOrigin;

      if (!countryMatches) continue;

      // Check effective/expiration dates
      if (tax.effectiveDate && tax.effectiveDate > now) continue;
      if (tax.expirationDate && tax.expirationDate < now) continue;

      // Evaluate formula
      if (tax.rateFormula) {
        try {
          let amount = this.formulaEvaluationService.evaluate(
            tax.rateFormula,
            variables,
          );

          // Apply min/max constraints
          if (tax.minimumAmount !== null) {
            amount = Math.max(amount, tax.minimumAmount);
          }
          if (tax.maximumAmount !== null) {
            amount = Math.min(amount, tax.maximumAmount);
          }

          results.push({
            type: tax.taxCode,
            amount: Math.round(amount * 100) / 100,
            description: tax.description || tax.taxName,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to evaluate tax formula for ${tax.taxCode}: ${error.message}`,
          );
        }
      }
    }

    return results;
  }

  /**
   * Check trade agreement eligibility
   */
  private async checkTradeAgreement(
    input: CalculationInput,
  ): Promise<{
    agreement: string;
    eligible: boolean;
    preferentialRate?: number;
    preferentialFormula?: string;
    requiresCertificate?: boolean;
  }> {
    // If no trade agreement specified, return not eligible
    if (!input.tradeAgreementCode) {
      return { agreement: '', eligible: false };
    }

    try {
      // Check if HTS code is eligible for the trade agreement
      const eligibility = await this.tradeAgreementEligibilityRepository.findOne({
        where: {
          htsNumber: input.htsNumber,
          tradeAgreementCode: input.tradeAgreementCode,
          isEligible: true,
        },
      });

      if (!eligibility) {
        this.logger.debug(`No trade agreement eligibility found for ${input.htsNumber} under ${input.tradeAgreementCode}`);
        return { agreement: input.tradeAgreementCode, eligible: false };
      }

      // Check if certificate is required and provided
      if (eligibility.certificateRequired && !input.tradeAgreementCertificate) {
        this.logger.warn(`Certificate required for ${input.tradeAgreementCode} but not provided`);
        return {
          agreement: input.tradeAgreementCode,
          eligible: false,
          requiresCertificate: true,
        };
      }

      // Calculate preferential formula if rate type is available
      let preferentialFormula: string | undefined;
      if (eligibility.preferentialRate !== null) {
        if (eligibility.rateType === 'percentage') {
          preferentialFormula = `value * ${eligibility.preferentialRate / 100}`;
        } else if (eligibility.rateType === 'specific') {
          preferentialFormula = `weight * ${eligibility.preferentialRate}`;
        } else {
          preferentialFormula = `${eligibility.preferentialRate}`;
        }
      }

      return {
        agreement: input.tradeAgreementCode,
        eligible: true,
        preferentialRate: eligibility.preferentialRate || undefined,
        preferentialFormula,
        requiresCertificate: eligibility.certificateRequired,
      };
    } catch (error) {
      this.logger.error(`Trade agreement check failed: ${error.message}`);
      return { agreement: input.tradeAgreementCode, eligible: false };
    }
  }

  private async saveCalculationHistory(
    input: CalculationInput,
    result: CalculationResult,
  ): Promise<void> {
    const history = this.historyRepository.create({
      calculationId: result.calculationId,
      organizationId: input.organizationId,
      userId: input.userId || null,
      scenarioId: input.scenarioId || null,
      inputs: {
        htsNumber: input.htsNumber,
        countryOfOrigin: input.countryOfOrigin,
        declaredValue: input.declaredValue,
        currency: input.currency || 'USD',
        weightKg: input.weightKg,
        quantity: input.quantity,
        quantityUnit: input.quantityUnit,
      },
      baseDuty: result.baseDuty,
      additionalTariffs: result.additionalTariffs,
      totalTaxes: result.totalTaxes,
      totalDuty: result.totalDuty,
      landedCost: result.landedCost,
      breakdown: result.breakdown,
      tradeAgreementInfo: result.tradeAgreementInfo || null,
      complianceWarnings: null,
      htsVersion: input.htsVersion || '2025',
      ruleVersion: null,
      engineVersion: this.ENGINE_VERSION,
      formulaUsed: result.formulaUsed,
    });

    await this.historyRepository.save(history);
  }

  private generateCalculationId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `CALC-${timestamp}-${random}`.toUpperCase();
  }

  async getCalculationHistory(
    calculationId: string,
  ): Promise<CalculationHistoryEntity | null> {
    return this.historyRepository.findOne({
      where: { calculationId },
    });
  }
}
