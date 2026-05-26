import { Injectable } from '@nestjs/common';

/**
 * AuGstResolverService
 *
 * Australian GST on imports.
 *   - Standard rate: 10%
 *   - Base: customs value + duty + transport + insurance (T&I).
 *     This is the "VoTI" (Value of Taxable Importation) per s.13-20 GST
 *     Act 1999. CRITICALLY, this differs from US/EU practice — GST is
 *     levied on the LANDED value, not just the goods value.
 *   - Low-value imported goods (LVIG) ≤ AUD 1,000 from offshore registered
 *     suppliers: GST collected at point-of-sale under the LVIG / OST scheme.
 *     Otherwise levied at import alongside duty.
 *
 * Source: ATO GST on low-value imported goods —
 *   https://www.ato.gov.au/businesses-and-organisations/international-tax-for-business/gst-on-low-value-imported-goods
 */
@Injectable()
export class AuGstResolverService {
  private static readonly STANDARD_RATE = 0.1;

  /** AUD threshold for LVIG. ≤ this and offshore registered → GST at PoS. */
  static readonly LVIG_AUD = 1_000;

  compute(votiAud: number): { rate: number; amount: number; note: string } {
    const amount = votiAud * AuGstResolverService.STANDARD_RATE;
    return {
      rate: AuGstResolverService.STANDARD_RATE,
      amount,
      note: 'Australia GST 10% on Value of Taxable Importation (declared + duty + transport + insurance)',
    };
  }

  /**
   * Returns true when the shipment is in scope for the LVIG / OST scheme —
   * GST collected at PoS by the offshore registered supplier, not at border.
   */
  isLvig(declaredValueAud: number): boolean {
    return declaredValueAud <= AuGstResolverService.LVIG_AUD;
  }

  lvigThreshold(): number {
    return AuGstResolverService.LVIG_AUD;
  }
}
