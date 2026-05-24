import { Injectable } from '@nestjs/common';

export interface CaLowValueDecision {
  dutyExempt: boolean;
  taxExempt: boolean;
  reason: string;
}

/**
 * CaLowValueResolverService
 *
 * Canada has two distinct low-value thresholds:
 *   • CUSMA (US + Mexico courier shipments): CAD 40 for taxes,
 *     CAD 150 for duties. Postal shipments are excluded.
 *   • Personal exemption for casual imports of all origins: CAD 20.
 *
 * This resolver picks the right one based on ship-from country +
 * (optional) channel. Channel defaults to 'courier'.
 *
 * Source: Customs Tariff Act + CBSA D-Memoranda D17-1-22, D8-2-2.
 */
@Injectable()
export class CaLowValueResolverService {
  resolve(args: {
    declaredValueCad: number;
    shipFromCountry: string;
    channel?: 'courier' | 'postal';
  }): CaLowValueDecision {
    const value = args.declaredValueCad;
    const origin = (args.shipFromCountry || '').toUpperCase();
    const channel = args.channel || 'courier';

    // CUSMA: only courier from US / MX
    if (channel === 'courier' && (origin === 'US' || origin === 'MX')) {
      if (value < 40) {
        return {
          dutyExempt: true,
          taxExempt: true,
          reason: `CUSMA courier under CAD 40 from ${origin}: duty & tax free`,
        };
      }
      if (value < 150) {
        return {
          dutyExempt: true,
          taxExempt: false,
          reason: `CUSMA courier between CAD 40-150 from ${origin}: duty-free, taxes apply`,
        };
      }
    }

    // Generic casual import exemption — CAD 20 personal use.
    if (value < 20) {
      return {
        dutyExempt: true,
        taxExempt: true,
        reason: 'Casual import under CAD 20: duty & tax free',
      };
    }

    return {
      dutyExempt: false,
      taxExempt: false,
      reason: 'Standard border tariff + GST/HST apply',
    };
  }
}
