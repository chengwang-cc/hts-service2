import { Injectable } from '@nestjs/common';
import { PolicyApplicabilityService } from './policy-applicability.service';

export interface TariffConditionContext {
  countryOfOrigin: string;
  declaredValue?: number;
  tradeAgreementCode?: string;
  tradeAgreementCertificate?: boolean;
  additionalInputs?: Record<string, any>;
  selectedChapter99Headings?: Iterable<string>;
}

const EU_COUNTRY_CODES = new Set([
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

@Injectable()
export class TariffConditionEngineService {
  constructor(private readonly policy: PolicyApplicabilityService) {}

  evaluate(
    conditions: Record<string, any> | null | undefined,
    context: TariffConditionContext,
  ): boolean {
    if (!conditions || typeof conditions !== 'object') {
      return true;
    }
    if (this.isPolicyMarkerOnly(conditions)) {
      return false;
    }

    const selected = new Set(context.selectedChapter99Headings || []);

    if (
      this.policy.isTruthyFlag(conditions.requiresAnnexMapping) &&
      !this.policy.isTruthyFlag(
        context.additionalInputs?.annexEligibilityConfirmed,
      )
    ) {
      return false;
    }

    if (
      this.policy.isTruthyFlag(conditions.frameworkRateOnly) &&
      !this.policy.isTruthyFlag(context.additionalInputs?.allowFrameworkRate)
    ) {
      return false;
    }

    const requiredHeading = this.policy.normalizeChapter99Heading(
      typeof conditions.htsHeading === 'string' ? conditions.htsHeading : null,
    );
    if (requiredHeading && !selected.has(requiredHeading)) {
      return false;
    }

    const exceptionHeading = this.policy.normalizeChapter99Heading(
      typeof conditions.exceptionHeading === 'string'
        ? conditions.exceptionHeading
        : null,
    );
    if (exceptionHeading && !selected.has(exceptionHeading)) {
      return false;
    }

    if (
      typeof conditions.tradeAgreementCode === 'string' &&
      conditions.tradeAgreementCode.trim()
    ) {
      const expected = conditions.tradeAgreementCode.trim().toUpperCase();
      if ((context.tradeAgreementCode || '').toUpperCase() !== expected) {
        return false;
      }
    }

    if (
      this.policy.isTruthyFlag(conditions.requiresCertificate) &&
      !this.policy.isTruthyFlag(context.tradeAgreementCertificate)
    ) {
      return false;
    }

    const minValue = this.toFiniteNumber(conditions.minValue);
    if (
      minValue !== null &&
      typeof context.declaredValue === 'number' &&
      context.declaredValue < minValue
    ) {
      return false;
    }

    const maxValue = this.toFiniteNumber(conditions.maxValue);
    if (
      maxValue !== null &&
      typeof context.declaredValue === 'number' &&
      context.declaredValue > maxValue
    ) {
      return false;
    }

    if (
      Array.isArray(conditions.countryIn) &&
      conditions.countryIn.length > 0
    ) {
      const countryAllowed = conditions.countryIn.some((code: any) =>
        this.isCountryMatch(String(code || ''), context.countryOfOrigin),
      );
      if (!countryAllowed) return false;
    }

    if (
      Array.isArray(conditions.countryNotIn) &&
      conditions.countryNotIn.length > 0
    ) {
      const countryBlocked = conditions.countryNotIn.some((code: any) =>
        this.isCountryMatch(String(code || ''), context.countryOfOrigin),
      );
      if (countryBlocked) return false;
    }

    if (
      typeof conditions.modeOfTransport === 'string' &&
      conditions.modeOfTransport.trim()
    ) {
      const actualMode = String(context.additionalInputs?.modeOfTransport || '')
        .trim()
        .toUpperCase();
      if (actualMode !== conditions.modeOfTransport.trim().toUpperCase()) {
        return false;
      }
    }

    return true;
  }

  evaluateScope(
    conditions: Record<string, any> | null | undefined,
    context: Pick<
      TariffConditionContext,
      'countryOfOrigin' | 'selectedChapter99Headings'
    >,
  ): boolean {
    if (!conditions || typeof conditions !== 'object') {
      return true;
    }
    if (this.isPolicyMarkerOnly(conditions)) {
      return false;
    }

    const selected = new Set(context.selectedChapter99Headings || []);
    const requiredHeading = this.policy.normalizeChapter99Heading(
      typeof conditions.htsHeading === 'string' ? conditions.htsHeading : null,
    );
    if (requiredHeading && !selected.has(requiredHeading)) {
      return false;
    }

    const exceptionHeading = this.policy.normalizeChapter99Heading(
      typeof conditions.exceptionHeading === 'string'
        ? conditions.exceptionHeading
        : null,
    );
    if (exceptionHeading && !selected.has(exceptionHeading)) {
      return false;
    }

    if (
      Array.isArray(conditions.countryIn) &&
      conditions.countryIn.length > 0
    ) {
      const countryAllowed = conditions.countryIn.some((code: any) =>
        this.isCountryMatch(String(code || ''), context.countryOfOrigin),
      );
      if (!countryAllowed) return false;
    }

    if (
      Array.isArray(conditions.countryNotIn) &&
      conditions.countryNotIn.length > 0
    ) {
      const countryBlocked = conditions.countryNotIn.some((code: any) =>
        this.isCountryMatch(String(code || ''), context.countryOfOrigin),
      );
      if (countryBlocked) return false;
    }

    return true;
  }

  isPolicyMarkerOnly(conditions: Record<string, any> | null | undefined) {
    if (!conditions || typeof conditions !== 'object') {
      return false;
    }
    return (
      this.policy.isTruthyFlag((conditions as any).policyMarkerOnly) ||
      this.policy.isTruthyFlag((conditions as any).requiresManualReview)
    );
  }

  isCountryMatch(ruleCountryRaw: string, inputCountryRaw: string): boolean {
    const ruleCountry = (ruleCountryRaw || '').trim().toUpperCase();
    const inputCountry = (inputCountryRaw || '').trim().toUpperCase();
    if (!ruleCountry || !inputCountry) {
      return false;
    }

    if (ruleCountry === 'ALL' || ruleCountry === inputCountry) {
      return true;
    }

    if (ruleCountry === 'EU') {
      return inputCountry === 'EU' || EU_COUNTRY_CODES.has(inputCountry);
    }
    if (inputCountry === 'EU') {
      return EU_COUNTRY_CODES.has(ruleCountry);
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
}
