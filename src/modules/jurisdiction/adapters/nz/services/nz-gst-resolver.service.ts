import { Injectable } from '@nestjs/common';

/**
 * NzGstResolverService
 *
 * NZ GST on imports.
 *   - Standard rate: 15% (highest in our destination set)
 *   - Base: VfD (Value for Duty) + duty + transport + insurance — the
 *     "Customs Value for GST" per Customs and Excise Act 2018. Computed
 *     on landed value, NOT goods value alone.
 *   - LVIG threshold NZD 1,000: offshore registered supplier collects GST
 *     at PoS; calculator suppresses border GST.
 *
 * Source: Inland Revenue — https://www.ird.govt.nz/gst/charging-gst/gst-on-low-value-imported-goods
 */
@Injectable()
export class NzGstResolverService {
  private static readonly STANDARD_RATE = 0.15;

  static readonly LVIG_NZD = 1_000;

  compute(landedValueNzd: number): { rate: number; amount: number; note: string } {
    const amount = landedValueNzd * NzGstResolverService.STANDARD_RATE;
    return {
      rate: NzGstResolverService.STANDARD_RATE,
      amount,
      note: 'NZ GST 15% on landed value (declared + duty + transport + insurance)',
    };
  }

  isLvig(declaredValueNzd: number): boolean {
    return declaredValueNzd <= NzGstResolverService.LVIG_NZD;
  }

  lvigThreshold(): number {
    return NzGstResolverService.LVIG_NZD;
  }
}
