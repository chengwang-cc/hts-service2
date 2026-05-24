import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeAgreementEligibilityEntity } from '../entities';
import { RateRetrievalService } from './rate-retrieval.service';
import { FormulaEvaluationService } from './formula-evaluation.service';
import { HtsExtraTaxEntity, CalculationHistoryEntity } from '@hts/core';
import type { TariffSelectionMode } from '../dto/calculate.dto';

const FEE_TAX_CODE_PREFIXES = ['MPF', 'HMF'];

function classifyTaxAsFee(taxCode: string): boolean {
  const upper = (taxCode || '').toUpperCase();
  if (FEE_TAX_CODE_PREFIXES.some((p) => upper.startsWith(p))) return true;
  if (upper.includes('_FEE') || upper.endsWith('_FEE') || upper.includes('FEE_')) {
    return true;
  }
  return false;
}

export interface CalculationInput {
  htsNumber: string;
  countryOfOrigin: string;
  destinationCountry?: string;
  declaredValue: number;
  entryDate?: string;
  currency?: string;
  weightKg?: number;
  quantity?: number;
  quantityUnit?: string;
  organizationId: string;
  userId?: string;
  scenarioId?: string;
  tradeAgreementCode?: string;
  tradeAgreementCertificate?: boolean;
  tradeAgreement?: string;
  claimPreferential?: boolean;
  additionalInputs?: Record<string, any>;
  htsVersion?: string;
  tariffSelectionMode?: TariffSelectionMode;
}

export interface CalculationLineItem {
  type: string;
  amount: number;
  description: string;
}

export interface CalculationTotals {
  baseDuty: number;
  additionalTariffs: number;
  fees: number;
  taxes: number;
  totalDuty: number;
  landedCost: number;
}

export interface CalculationResult {
  calculationId: string;
  baseDuty: number;
  additionalTariffs: number;
  totalTaxes: number;
  /** New: fees broken out separately (MPF/HMF/declaration-style fees). */
  fees: number;
  totalDuty: number;
  landedCost: number;
  /** Structured totals; preferred shape for new clients. */
  totals: CalculationTotals;
  breakdown: any;
  formulaUsed: string;
  rateSource: string;
  confidence: number;
  destinationCountry: string;
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
  private readonly EU_COUNTRY_CODES = new Set<string>([
    'AT',
    'BE',
    'BG',
    'HR',
    'CY',
    'CZ',
    'DK',
    'EE',
    'FI',
    'FR',
    'DE',
    'GR',
    'HU',
    'IE',
    'IT',
    'LV',
    'LT',
    'LU',
    'MT',
    'NL',
    'PL',
    'PT',
    'RO',
    'SK',
    'SI',
    'ES',
    'SE',
  ]);

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
      const normalizedInput = this.normalizeCalculationInput(input);
      const calculationDate = this.resolveCalculationDate(normalizedInput);
      const canonicalEntryDate = this.formatDateOnly(calculationDate);
      const calculationInput: CalculationInput = {
        ...normalizedInput,
        entryDate: canonicalEntryDate,
        // Auto-inject reciprocal-tariff Chapter 99 headings the caller
        // didn't explicitly pass. ai-service does this implicitly; without
        // it, the seeded RECIP_BASELINE_9903_01_25 + country exception
        // rows in `hts_extra_taxes` never fire and we systematically
        // under-report duty vs ai-service.
        additionalInputs: this.applyReciprocalAutoHeadings(
          normalizedInput.additionalInputs,
          normalizedInput.countryOfOrigin,
          calculationDate,
        ),
      };
      const selectedChapter99Headings = this.extractSelectedChapter99Headings(
        calculationInput.additionalInputs,
      );
      const rateInfo = await this.rateRetrievalService.getRate(
        calculationInput.htsNumber,
        calculationInput.countryOfOrigin,
        calculationInput.htsVersion,
        {
          entryDate: canonicalEntryDate,
          selectedChapter99Headings: Array.from(selectedChapter99Headings),
        },
      );

      const baseVariables = {
        value: calculationInput.declaredValue,
        weight: calculationInput.weightKg,
        quantity: calculationInput.quantity,
      };

      const declaredBaseVariables = (rateInfo.variables || []).map(
        (v) => v.name,
      );

      // Check for trade agreement eligibility
      const tradeAgreementInfo =
        await this.checkTradeAgreement(calculationInput);

      // Use preferential rate if eligible, otherwise use standard rate
      let baseDuty: number;
      let formulaUsed: string;
      let rateSource: string;

      if (
        tradeAgreementInfo.eligible &&
        tradeAgreementInfo.preferentialFormula
      ) {
        baseDuty = this.formulaEvaluationService.evaluate(
          tradeAgreementInfo.preferentialFormula,
          {
            ...baseVariables,
            additionalInputs: calculationInput.additionalInputs || {},
            declaredVariables: declaredBaseVariables,
          },
        );
        formulaUsed = tradeAgreementInfo.preferentialFormula;
        rateSource = `trade-agreement-${tradeAgreementInfo.agreement}`;
        this.logger.log(
          `Using preferential rate from ${tradeAgreementInfo.agreement}`,
        );
      } else {
        baseDuty = this.formulaEvaluationService.evaluate(rateInfo.formula, {
          ...baseVariables,
          additionalInputs: calculationInput.additionalInputs || {},
          declaredVariables: declaredBaseVariables,
        });
        formulaUsed = rateInfo.formula;
        rateSource = rateInfo.source;
      }

      const additionalTariffVariables = {
        ...baseVariables,
        duty: baseDuty,
        total: calculationInput.declaredValue + baseDuty,
      };

      const applyExtraTaxes = !rateInfo.overrideExtraTax;

      // Calculate additional tariffs (entity-driven)
      const additionalTariffs = applyExtraTaxes
        ? await this.calculateAdditionalTariffs(
            calculationInput,
            additionalTariffVariables,
            calculationDate,
          )
        : [];

      const totalAdditionalTariffs = additionalTariffs.reduce(
        (sum, t) => sum + t.amount,
        0,
      );

      const postTariffDuty = baseDuty + totalAdditionalTariffs;
      const postTariffTotal = calculationInput.declaredValue + postTariffDuty;
      const taxVariables = {
        ...baseVariables,
        duty: postTariffDuty,
        total: postTariffTotal,
      };

      // Calculate taxes (entity-driven)
      const taxes = applyExtraTaxes
        ? await this.calculateTaxes(
            calculationInput,
            taxVariables,
            calculationDate,
          )
        : [];

      // Split MPF / HMF / generic fees out of the taxes bucket so the
      // top-level totals carry a clean (taxes vs fees) distinction.
      const fees = taxes.filter((t) => classifyTaxAsFee(t.type));
      const trueTaxes = taxes.filter((t) => !classifyTaxAsFee(t.type));
      const totalFees = fees.reduce((sum, t) => sum + t.amount, 0);
      const totalTaxes = trueTaxes.reduce((sum, t) => sum + t.amount, 0);
      const totalDuty = postTariffDuty;
      const landedCost =
        calculationInput.declaredValue + totalDuty + totalTaxes + totalFees;
      const destinationCountry = (
        calculationInput.destinationCountry || 'US'
      ).toUpperCase();

      const round = (n: number) => Math.round(n * 100) / 100;
      const totals: CalculationTotals = {
        baseDuty: round(baseDuty),
        additionalTariffs: round(totalAdditionalTariffs),
        fees: round(totalFees),
        taxes: round(totalTaxes),
        totalDuty: round(totalDuty),
        landedCost: round(landedCost),
      };

      const result: CalculationResult = {
        calculationId,
        baseDuty: totals.baseDuty,
        additionalTariffs: totals.additionalTariffs,
        totalTaxes: totals.taxes,
        fees: totals.fees,
        totalDuty: totals.totalDuty,
        landedCost: totals.landedCost,
        totals,
        destinationCountry,
        breakdown: {
          baseDuty: totals.baseDuty,
          additionalTariffs,
          fees,
          taxes: trueTaxes,
          totalDuty: totals.totalDuty,
          totalTax: totals.taxes,
          totalFees: totals.fees,
          landedCost: totals.landedCost,
        },
        formulaUsed,
        rateSource,
        confidence: rateInfo.confidence,
        tradeAgreementInfo: tradeAgreementInfo.eligible
          ? tradeAgreementInfo
          : null,
      };

      if (calculationInput.organizationId) {
        await this.saveCalculationHistory(calculationInput, result);
      }

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
    calculationDate: Date,
  ): Promise<Array<{ type: string; amount: number; description: string }>> {
    const chapter = input.htsNumber.substring(0, 2);
    const selectedChapter99Headings = this.extractSelectedChapter99Headings(
      input.additionalInputs,
    );

    // Load ADD_ON/STANDALONE/CONDITIONAL so conditional exclusions can gate ADD_ON rules.
    const allTariffs = await this.extraTaxRepository.find({
      where: [
        { isActive: true, extraRateType: 'ADD_ON' },
        { isActive: true, extraRateType: 'STANDALONE' },
        { isActive: true, extraRateType: 'CONDITIONAL' },
      ],
      order: {
        priority: 'ASC',
      },
    });

    const matchedConditionalPolicies = allTariffs.filter((policy) => {
      const type = (policy.extraRateType || '').toUpperCase();
      if (type !== 'CONDITIONAL') {
        return false;
      }
      if (!this.matchesTaxScope(policy, input, chapter, calculationDate)) {
        return false;
      }
      return this.evaluateTaxConditions(
        policy.conditions,
        input,
        selectedChapter99Headings,
      );
    });
    const excludeReciprocalBaseline = matchedConditionalPolicies.some(
      (policy) =>
        this.isTruthyFlag((policy.conditions || {}).excludesReciprocalBaseline),
    );

    const results: Array<{
      type: string;
      amount: number;
      description: string;
    }> = [];

    for (const tariff of allTariffs) {
      const type = (tariff.extraRateType || '').toUpperCase();
      if (type === 'CONDITIONAL') {
        continue;
      }
      if (type !== 'ADD_ON' && type !== 'STANDALONE') {
        continue;
      }
      if (!this.matchesTaxScope(tariff, input, chapter, calculationDate)) {
        continue;
      }
      if (
        !this.evaluateTaxConditions(
          tariff.conditions,
          input,
          selectedChapter99Headings,
        )
      ) {
        continue;
      }
      if (this.isPolicyMarkerOnly(tariff.conditions)) {
        continue;
      }

      // Reciprocal baseline rows are suppressed when a matching conditional exception is present.
      if (excludeReciprocalBaseline && this.isReciprocalBaselineRule(tariff)) {
        this.logger.debug(
          `Skipping reciprocal baseline tariff ${tariff.taxCode} due to matched conditional exclusion`,
        );
        continue;
      }

      // Evaluate formula
      if (tariff.rateFormula) {
        try {
          const amount = this.formulaEvaluationService.evaluate(
            tariff.rateFormula,
            {
              ...variables,
              additionalInputs: input.additionalInputs || {},
              declaredVariables: this.extractFormulaIdentifiers(
                tariff.rateFormula,
              ),
            },
          );
          if (amount <= 0) {
            continue;
          }

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
    calculationDate: Date,
  ): Promise<Array<{ type: string; amount: number; description: string }>> {
    const chapter = input.htsNumber.substring(0, 2);
    const selectedChapter99Headings = this.extractSelectedChapter99Headings(
      input.additionalInputs,
    );

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

    const results: Array<{
      type: string;
      amount: number;
      description: string;
    }> = [];

    for (const tax of allTaxes) {
      if (!this.matchesTaxScope(tax, input, chapter, calculationDate)) {
        continue;
      }
      if (
        !this.evaluateTaxConditions(
          tax.conditions,
          input,
          selectedChapter99Headings,
        )
      ) {
        continue;
      }
      if (this.isPolicyMarkerOnly(tax.conditions)) {
        continue;
      }

      // Evaluate formula
      if (tax.rateFormula) {
        try {
          let amount = this.formulaEvaluationService.evaluate(tax.rateFormula, {
            ...variables,
            additionalInputs: input.additionalInputs || {},
            declaredVariables: this.extractFormulaIdentifiers(tax.rateFormula),
          });
          if (amount <= 0) {
            continue;
          }

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
  private async checkTradeAgreement(input: CalculationInput): Promise<{
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
      const eligibility =
        await this.tradeAgreementEligibilityRepository.findOne({
          where: {
            htsNumber: input.htsNumber,
            tradeAgreementCode: input.tradeAgreementCode,
            isEligible: true,
          },
        });

      if (!eligibility) {
        this.logger.debug(
          `No trade agreement eligibility found for ${input.htsNumber} under ${input.tradeAgreementCode}`,
        );
        return { agreement: input.tradeAgreementCode, eligible: false };
      }

      // Check if certificate is required and provided
      if (eligibility.certificateRequired && !input.tradeAgreementCertificate) {
        this.logger.warn(
          `Certificate required for ${input.tradeAgreementCode} but not provided`,
        );
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
        entryDate: input.entryDate || null,
        tradeAgreement: input.tradeAgreementCode || input.tradeAgreement,
        claimPreferential:
          typeof input.tradeAgreementCertificate === 'boolean'
            ? input.tradeAgreementCertificate
            : input.claimPreferential,
        additionalInputs: input.additionalInputs,
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

  private normalizeCalculationInput(input: CalculationInput): CalculationInput {
    const tradeAgreementCodeRaw =
      typeof input.tradeAgreementCode === 'string' &&
      input.tradeAgreementCode.trim()
        ? input.tradeAgreementCode
        : input.tradeAgreement;
    const tradeAgreementCode = tradeAgreementCodeRaw
      ? tradeAgreementCodeRaw.trim().toUpperCase()
      : undefined;

    const tradeAgreementCertificate =
      typeof input.tradeAgreementCertificate === 'boolean'
        ? input.tradeAgreementCertificate
        : typeof input.claimPreferential === 'boolean'
          ? input.claimPreferential
          : undefined;

    const additionalInputs =
      input.additionalInputs && typeof input.additionalInputs === 'object'
        ? input.additionalInputs
        : undefined;

    return {
      ...input,
      htsNumber: (input.htsNumber || '').trim(),
      countryOfOrigin: (input.countryOfOrigin || '').trim().toUpperCase(),
      entryDate:
        typeof input.entryDate === 'string' && input.entryDate.trim()
          ? input.entryDate.trim()
          : undefined,
      tradeAgreementCode,
      tradeAgreementCertificate,
      additionalInputs,
    };
  }

  private matchesTaxScope(
    tax: HtsExtraTaxEntity,
    input: CalculationInput,
    chapter: string,
    calculationDate: Date,
  ): boolean {
    const inputCountry = (input.countryOfOrigin || '').toUpperCase();
    const taxCountry = (tax.countryCode || 'ALL').toUpperCase();
    const htsNumber = (input.htsNumber || '').trim();

    // CRITICAL BUG FIX (2026-05-23): the OR chain below treated
    // `htsChapter` as a parallel match condition, so a row with both a
    // specific htsNumber AND a chapter would fire for EVERY hts in that
    // chapter — turning 1-row Section 301 rules into chapter-wide carpet
    // bombs (see parity run e0aa3ef4 where 8402.11.00.00/CN evaluated 51
    // components and produced 880% duty on a $100 import).
    //
    // Correct precedence:
    //   1. If the row pins an exact htsNumber → only that htsNumber matches.
    //   2. Else if the row pins an htsChapter → only that chapter matches.
    //   3. Else (wildcard / null) → matches everything (e.g. MPF/HMF).
    const taxHtsNumber = (tax.htsNumber || '').trim();
    let htsMatches: boolean;
    if (taxHtsNumber && taxHtsNumber !== '*') {
      htsMatches = taxHtsNumber === htsNumber;
    } else if (tax.htsChapter) {
      htsMatches = tax.htsChapter === chapter;
    } else {
      htsMatches = true;
    }
    if (!htsMatches) return false;

    const countryMatches = this.isCountryMatch(taxCountry, inputCountry);
    if (!countryMatches) return false;

    const normalizedCalcDate = this.toDateOnlyUtc(calculationDate);
    const effectiveDate = this.toDateOnlyUtc(tax.effectiveDate as any);
    const expirationDate = this.toDateOnlyUtc(tax.expirationDate as any);

    if (!normalizedCalcDate) {
      return true;
    }

    if (effectiveDate && effectiveDate.getTime() > normalizedCalcDate.getTime())
      return false;
    if (
      expirationDate &&
      expirationDate.getTime() < normalizedCalcDate.getTime()
    )
      return false;

    return true;
  }

  private evaluateTaxConditions(
    conditions: Record<string, any> | null,
    input: CalculationInput,
    selectedChapter99Headings: Set<string>,
  ): boolean {
    if (!conditions || typeof conditions !== 'object') {
      return true;
    }

    // Marker-only rows are metadata and should not execute as charge rows.
    if (this.isPolicyMarkerOnly(conditions)) {
      return false;
    }

    if (
      this.isTruthyFlag(conditions.requiresAnnexMapping) &&
      !this.isTruthyFlag(input.additionalInputs?.annexEligibilityConfirmed)
    ) {
      return false;
    }

    if (
      this.isTruthyFlag(conditions.frameworkRateOnly) &&
      !this.isTruthyFlag(input.additionalInputs?.allowFrameworkRate)
    ) {
      return false;
    }

    const requiredHeading = this.normalizeChapter99Heading(
      typeof conditions.htsHeading === 'string' ? conditions.htsHeading : null,
    );
    if (requiredHeading && !selectedChapter99Headings.has(requiredHeading)) {
      return false;
    }

    const exceptionHeading = this.normalizeChapter99Heading(
      typeof conditions.exceptionHeading === 'string'
        ? conditions.exceptionHeading
        : null,
    );
    if (exceptionHeading && !selectedChapter99Headings.has(exceptionHeading)) {
      return false;
    }

    if (
      typeof conditions.tradeAgreementCode === 'string' &&
      conditions.tradeAgreementCode.trim()
    ) {
      const expected = conditions.tradeAgreementCode.trim().toUpperCase();
      if ((input.tradeAgreementCode || '').toUpperCase() !== expected) {
        return false;
      }
    }

    if (
      this.isTruthyFlag(conditions.requiresCertificate) &&
      !this.isTruthyFlag(input.tradeAgreementCertificate)
    ) {
      return false;
    }

    const minValue = this.toFiniteNumber(conditions.minValue);
    if (minValue !== null && input.declaredValue < minValue) {
      return false;
    }

    const maxValue = this.toFiniteNumber(conditions.maxValue);
    if (maxValue !== null && input.declaredValue > maxValue) {
      return false;
    }

    if (
      Array.isArray(conditions.countryIn) &&
      conditions.countryIn.length > 0
    ) {
      const inputCountry = (input.countryOfOrigin || '').toUpperCase();
      const whitelist = conditions.countryIn.map((code: any) =>
        String(code || '')
          .toUpperCase()
          .trim(),
      );
      const countryAllowed = whitelist.some((code) =>
        this.isCountryMatch(code, inputCountry),
      );
      if (!countryAllowed) {
        return false;
      }
    }

    if (
      Array.isArray(conditions.countryNotIn) &&
      conditions.countryNotIn.length > 0
    ) {
      const inputCountry = (input.countryOfOrigin || '').toUpperCase();
      const blacklist = conditions.countryNotIn.map((code: any) =>
        String(code || '')
          .toUpperCase()
          .trim(),
      );
      const countryBlocked = blacklist.some((code) =>
        this.isCountryMatch(code, inputCountry),
      );
      if (countryBlocked) {
        return false;
      }
    }

    if (
      typeof conditions.modeOfTransport === 'string' &&
      conditions.modeOfTransport.trim()
    ) {
      const actualMode = String(input.additionalInputs?.modeOfTransport || '')
        .trim()
        .toUpperCase();
      if (actualMode !== conditions.modeOfTransport.trim().toUpperCase()) {
        return false;
      }
    }

    return true;
  }

  private extractSelectedChapter99Headings(
    additionalInputs?: Record<string, any>,
  ): Set<string> {
    const headings = new Set<string>();
    if (!additionalInputs || typeof additionalInputs !== 'object') {
      return headings;
    }

    const directCandidates = [
      additionalInputs.chapter99Heading,
      additionalInputs.selectedChapter99Heading,
      additionalInputs.chapter99Code,
      additionalInputs.chapter99Hts,
    ];
    for (const candidate of directCandidates) {
      const normalized = this.normalizeChapter99Heading(
        typeof candidate === 'string' ? candidate : null,
      );
      if (normalized) {
        headings.add(normalized);
      }
    }

    const arrayCandidates = [
      additionalInputs.chapter99Headings,
      additionalInputs.selectedChapter99Headings,
    ];
    for (const values of arrayCandidates) {
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const normalized = this.normalizeChapter99Heading(
          typeof value === 'string' ? value : null,
        );
        if (normalized) {
          headings.add(normalized);
        }
      }
    }

    const mapCandidates = [
      additionalInputs.chapter99Selections,
      additionalInputs.FIELD_CHOSEN_HTS_CODES,
    ];
    for (const mapValue of mapCandidates) {
      if (
        !mapValue ||
        typeof mapValue !== 'object' ||
        Array.isArray(mapValue)
      ) {
        continue;
      }
      for (const [rawCode, enabled] of Object.entries(mapValue)) {
        if (!this.isTruthyFlag(enabled)) {
          continue;
        }
        const normalized = this.normalizeChapter99Heading(rawCode);
        if (normalized) {
          headings.add(normalized);
        }
      }
    }

    return headings;
  }

  private normalizeChapter99Heading(value: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (/^99\d{2}\.\d{2}\.\d{2}(?:\.\d{2})?$/.test(trimmed)) {
      return trimmed;
    }

    const digits = trimmed.replace(/[^0-9]/g, '');
    if (/^99\d{6}$/.test(digits)) {
      return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
    }
    if (/^99\d{8}$/.test(digits)) {
      return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}.${digits.slice(8, 10)}`;
    }

    return null;
  }

  private isReciprocalBaselineRule(tax: HtsExtraTaxEntity): boolean {
    const taxCode = (tax.taxCode || '').toUpperCase();
    const countryCode = (tax.countryCode || '').toUpperCase();
    return taxCode.startsWith('RECIP_') && countryCode === 'ALL';
  }

  private isPolicyMarkerOnly(
    conditions: Record<string, any> | null | undefined,
  ): boolean {
    if (!conditions || typeof conditions !== 'object') {
      return false;
    }
    return (
      this.isTruthyFlag((conditions as any).policyMarkerOnly) ||
      this.isTruthyFlag((conditions as any).requiresManualReview)
    );
  }

  private isTruthyFlag(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
    }
    return false;
  }

  private toFiniteNumber(value: any): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private formatDateOnly(value: Date): string {
    const normalized = this.toDateOnlyUtc(value) || value;
    return normalized.toISOString().slice(0, 10);
  }

  private resolveCalculationDate(input: CalculationInput): Date {
    const candidates = [
      input.entryDate,
      input.additionalInputs?.entryDate,
      input.additionalInputs?.FIELD_DATE_OF_LOADING,
      input.additionalInputs?.dateOfLoading,
      input.additionalInputs?.entryDateOverride,
    ];

    for (const candidate of candidates) {
      const parsed = this.parseFlexibleDate(candidate);
      if (parsed) {
        return parsed;
      }
    }

    return new Date();
  }

  private parseFlexibleDate(value: unknown): Date | null {
    if (typeof value !== 'string') {
      return null;
    }

    const raw = value.trim();
    if (!raw) {
      return null;
    }

    const unquoted = raw.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
    const dateOnlyMatch = unquoted.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const parsed = new Date(
        `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}T12:00:00Z`,
      );
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(unquoted);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toDateOnlyUtc(value: Date | string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    let parsed: Date | null = null;
    if (value instanceof Date) {
      parsed = Number.isNaN(value.getTime()) ? null : value;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        parsed = new Date(`${trimmed}T12:00:00Z`);
      } else {
        parsed = new Date(trimmed);
      }
      if (Number.isNaN(parsed.getTime())) {
        return null;
      }
    }

    if (!parsed) {
      return null;
    }

    return new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
        12,
      ),
    );
  }

  /**
   * Reciprocal Chapter-99 heading auto-selector (IEEPA framework — EO of
   * April 2, 2025; baseline effective April 5, 2025).
   *
   * For any import on/after the effective date, ai-service applies the
   * 10% reciprocal baseline (heading 9903.01.25) automatically. If the
   * country has a published EO exception (CA → 9903.01.26, MX → 9903.01.27),
   * that exception fires instead, suppressing the baseline.
   *
   * hts-service stores both the baseline (ADD_ON) and the country
   * exceptions (CONDITIONAL with `excludesReciprocalBaseline: true`) in
   * `hts_extra_taxes` — but every row's `conditions.htsHeading` /
   * `exceptionHeading` requires the caller to PRE-SELECT the heading via
   * `additionalInputs.chapter99Headings`. This helper does the auto-select
   * so callers (calculator-v2 UI, parity sweep, widget) don't have to.
   *
   * Callers that genuinely don't want the baseline (e.g., historical
   * recalculation) can opt out via
   * `additionalInputs.skipReciprocalBaseline = true`.
   */
  private static readonly RECIPROCAL_BASELINE_EFFECTIVE = new Date(
    Date.UTC(2025, 3, 5), // April 5, 2025
  );

  private static readonly RECIPROCAL_COUNTRY_EXCEPTIONS: Record<string, string> = {
    CA: '9903.01.26',
    MX: '9903.01.27',
  };

  private static readonly RECIPROCAL_BASELINE_HEADING = '9903.01.25';

  private applyReciprocalAutoHeadings(
    additionalInputs: Record<string, any> | undefined,
    countryOfOrigin: string,
    calculationDate: Date,
  ): Record<string, any> | undefined {
    const inputs = additionalInputs ? { ...additionalInputs } : {};
    if (this.isTruthyFlag(inputs.skipReciprocalBaseline)) return inputs;
    if (
      calculationDate.getTime() <
      CalculationService.RECIPROCAL_BASELINE_EFFECTIVE.getTime()
    ) {
      return inputs;
    }

    const existing = Array.isArray(inputs.chapter99Headings)
      ? inputs.chapter99Headings.slice()
      : [];
    const country = (countryOfOrigin || '').toUpperCase();
    const auto =
      CalculationService.RECIPROCAL_COUNTRY_EXCEPTIONS[country] ??
      CalculationService.RECIPROCAL_BASELINE_HEADING;

    if (!existing.includes(auto)) {
      existing.push(auto);
    }
    inputs.chapter99Headings = existing;
    return inputs;
  }

  private extractFormulaIdentifiers(formula: string): string[] {
    if (!formula) return [];
    const out = new Set<string>();
    const re = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let m: RegExpExecArray | null;
    const mathKeywords = new Set([
      'min',
      'max',
      'abs',
      'round',
      'ceil',
      'floor',
      'log',
      'sqrt',
      'pow',
      'exp',
      'PI',
      'e',
      'true',
      'false',
      'mod',
    ]);
    while ((m = re.exec(formula)) !== null) {
      const name = m[1];
      if (mathKeywords.has(name)) continue;
      out.add(name);
    }
    return Array.from(out);
  }

  private isCountryMatch(
    ruleCountryRaw: string,
    inputCountryRaw: string,
  ): boolean {
    const ruleCountry = (ruleCountryRaw || '').trim().toUpperCase();
    const inputCountry = (inputCountryRaw || '').trim().toUpperCase();
    if (!ruleCountry || !inputCountry) {
      return false;
    }

    if (ruleCountry === 'ALL' || ruleCountry === inputCountry) {
      return true;
    }

    if (ruleCountry === 'EU') {
      return inputCountry === 'EU' || this.EU_COUNTRY_CODES.has(inputCountry);
    }
    if (inputCountry === 'EU') {
      return this.EU_COUNTRY_CODES.has(ruleCountry);
    }

    return false;
  }
}
