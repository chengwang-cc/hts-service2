import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeAgreementEligibilityEntity } from '../entities';
import { RateRetrievalService } from './rate-retrieval.service';
import { FormulaEvaluationService } from './formula-evaluation.service';
import { HtsExtraTaxEntity, CalculationHistoryEntity } from '@hts/core';

export interface CalculationInput {
  htsNumber: string;
  countryOfOrigin: string;
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
      const rateInfo = await this.rateRetrievalService.getRate(
        normalizedInput.htsNumber,
        normalizedInput.countryOfOrigin,
        normalizedInput.htsVersion,
      );

      const baseVariables = {
        value: normalizedInput.declaredValue,
        weight: normalizedInput.weightKg,
        quantity: normalizedInput.quantity,
      };

      // Check for trade agreement eligibility
      const tradeAgreementInfo = await this.checkTradeAgreement(normalizedInput);

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
        total: normalizedInput.declaredValue + baseDuty,
      };

      const applyExtraTaxes = !rateInfo.overrideExtraTax;

      // Calculate additional tariffs (entity-driven)
      const additionalTariffs = applyExtraTaxes
        ? await this.calculateAdditionalTariffs(normalizedInput, variables)
        : [];

      const totalAdditionalTariffs = additionalTariffs.reduce(
        (sum, t) => sum + t.amount,
        0,
      );

      // Calculate taxes (entity-driven)
      const taxes = applyExtraTaxes ? await this.calculateTaxes(normalizedInput, variables) : [];

      const totalTaxes = taxes.reduce((sum, t) => sum + t.amount, 0);
      const totalDuty = baseDuty + totalAdditionalTariffs;
      const landedCost = normalizedInput.declaredValue + totalDuty + totalTaxes;

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

      await this.saveCalculationHistory(normalizedInput, result);

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
    const calculationDate = this.resolveCalculationDate(input);
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
      return this.evaluateTaxConditions(policy.conditions, input, selectedChapter99Headings);
    });
    const excludeReciprocalBaseline = matchedConditionalPolicies.some((policy) =>
      this.isTruthyFlag((policy.conditions || {}).excludesReciprocalBaseline),
    );

    const results: Array<{ type: string; amount: number; description: string }> = [];

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
      if (!this.evaluateTaxConditions(tariff.conditions, input, selectedChapter99Headings)) {
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
            variables,
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
  ): Promise<Array<{ type: string; amount: number; description: string }>> {
    const calculationDate = this.resolveCalculationDate(input);
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

    const results: Array<{ type: string; amount: number; description: string }> = [];

    for (const tax of allTaxes) {
      if (!this.matchesTaxScope(tax, input, chapter, calculationDate)) {
        continue;
      }
      if (!this.evaluateTaxConditions(tax.conditions, input, selectedChapter99Headings)) {
        continue;
      }
      if (this.isPolicyMarkerOnly(tax.conditions)) {
        continue;
      }

      // Evaluate formula
      if (tax.rateFormula) {
        try {
          let amount = this.formulaEvaluationService.evaluate(
            tax.rateFormula,
            variables,
          );
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
      typeof input.tradeAgreementCode === 'string' && input.tradeAgreementCode.trim()
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

    const htsMatches =
      !tax.htsNumber ||
      tax.htsNumber === '*' ||
      tax.htsNumber === htsNumber ||
      (tax.htsChapter && tax.htsChapter === chapter);
    if (!htsMatches) return false;

    const countryMatches = this.isCountryMatch(taxCountry, inputCountry);
    if (!countryMatches) return false;

    const normalizedCalcDate = this.toDateOnlyUtc(calculationDate);
    const effectiveDate = this.toDateOnlyUtc(tax.effectiveDate as any);
    const expirationDate = this.toDateOnlyUtc(tax.expirationDate as any);

    if (!normalizedCalcDate) {
      return true;
    }

    if (effectiveDate && effectiveDate.getTime() > normalizedCalcDate.getTime()) return false;
    if (expirationDate && expirationDate.getTime() < normalizedCalcDate.getTime()) return false;

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
      typeof conditions.exceptionHeading === 'string' ? conditions.exceptionHeading : null,
    );
    if (exceptionHeading && !selectedChapter99Headings.has(exceptionHeading)) {
      return false;
    }

    if (typeof conditions.tradeAgreementCode === 'string' && conditions.tradeAgreementCode.trim()) {
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

    if (Array.isArray(conditions.countryIn) && conditions.countryIn.length > 0) {
      const inputCountry = (input.countryOfOrigin || '').toUpperCase();
      const whitelist = conditions.countryIn.map((code: any) =>
        String(code || '').toUpperCase().trim(),
      );
      const countryAllowed = whitelist.some((code) => this.isCountryMatch(code, inputCountry));
      if (!countryAllowed) {
        return false;
      }
    }

    if (Array.isArray(conditions.countryNotIn) && conditions.countryNotIn.length > 0) {
      const inputCountry = (input.countryOfOrigin || '').toUpperCase();
      const blacklist = conditions.countryNotIn.map((code: any) =>
        String(code || '').toUpperCase().trim(),
      );
      const countryBlocked = blacklist.some((code) => this.isCountryMatch(code, inputCountry));
      if (countryBlocked) {
        return false;
      }
    }

    if (typeof conditions.modeOfTransport === 'string' && conditions.modeOfTransport.trim()) {
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
      if (!mapValue || typeof mapValue !== 'object' || Array.isArray(mapValue)) {
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

  private isPolicyMarkerOnly(conditions: Record<string, any> | null | undefined): boolean {
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
      const parsed = new Date(`${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}T12:00:00Z`);
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
      Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12),
    );
  }

  private isCountryMatch(ruleCountryRaw: string, inputCountryRaw: string): boolean {
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
