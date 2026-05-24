import { Injectable, Logger } from '@nestjs/common';

export interface ViesValidationResult {
  valid: boolean;
  countryCode: string;
  vatNumber: string;
  source: 'format_only' | 'vies_api';
  warnings: string[];
}

/**
 * ViesValidationService
 *
 * Format-level VAT id validation (length + country code prefix per the EU
 * format catalogue). The full live VIES SOAP call to
 * `https://ec.europa.eu/taxation_customs/vies/services/checkVatService`
 * is intentionally NOT implemented here — it requires a SOAP client and
 * is rate-limited.
 *
 * Production deployments should add a real `checkVatNumber` call with
 * 24h caching and persistent audit evidence in `vies_validations` (a
 * follow-up entity). For now the resolver returns `valid: true` for
 * well-formatted ids + a warning that the response is format-only.
 */
@Injectable()
export class ViesValidationService {
  private readonly logger = new Logger(ViesValidationService.name);

  // Per https://ec.europa.eu/taxation_customs/vies/faqvies.do
  private readonly FORMAT: Record<string, RegExp> = {
    AT: /^U\d{8}$/,
    BE: /^[01]\d{9}$/,
    BG: /^\d{9,10}$/,
    HR: /^\d{11}$/,
    CY: /^\d{8}[A-Z]$/,
    CZ: /^\d{8,10}$/,
    DK: /^\d{8}$/,
    EE: /^\d{9}$/,
    FI: /^\d{8}$/,
    FR: /^[A-Z0-9]{2}\d{9}$/,
    DE: /^\d{9}$/,
    GR: /^\d{9}$/,
    HU: /^\d{8}$/,
    IE: /^\d[A-Z0-9*+]\d{5}[A-Z]{1,2}$/,
    IT: /^\d{11}$/,
    LV: /^\d{11}$/,
    LT: /^(\d{9}|\d{12})$/,
    LU: /^\d{8}$/,
    MT: /^\d{8}$/,
    NL: /^\d{9}B\d{2}$/,
    PL: /^\d{10}$/,
    PT: /^\d{9}$/,
    RO: /^\d{2,10}$/,
    SK: /^\d{10}$/,
    SI: /^\d{8}$/,
    ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
    SE: /^\d{12}$/,
  };

  validate(vatId: string): ViesValidationResult {
    const raw = (vatId || '').trim().toUpperCase();
    const cc = raw.slice(0, 2);
    const num = raw.slice(2);
    const re = this.FORMAT[cc];
    if (!re) {
      return {
        valid: false,
        countryCode: cc,
        vatNumber: num,
        source: 'format_only',
        warnings: ['UNKNOWN_VAT_COUNTRY_CODE'],
      };
    }
    if (!re.test(num)) {
      return {
        valid: false,
        countryCode: cc,
        vatNumber: num,
        source: 'format_only',
        warnings: ['VAT_FORMAT_INVALID'],
      };
    }
    return {
      valid: true,
      countryCode: cc,
      vatNumber: num,
      source: 'format_only',
      warnings: ['VIES_LIVE_VALIDATION_NOT_PERFORMED'],
    };
  }
}
