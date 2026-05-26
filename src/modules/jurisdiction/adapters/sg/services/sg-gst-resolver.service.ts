import { Injectable } from '@nestjs/common';

/**
 * SgGstResolverService
 *
 * Singapore GST (Goods and Services Tax) on imports.
 *   - Standard rate: 9% (effective 1 Jan 2024; was 8% in 2023)
 *   - Base: customs-duty-paid CIF value (declared + duty + shipping + insurance)
 *   - Low-value imported goods (LVIG) ≤ SGD 400 from offshore registered
 *     suppliers (OVR scheme): GST collected at point-of-sale, NOT at border.
 *     Otherwise levied at import.
 *
 * Source: IRAS https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-and-digital-economy/gst-on-imports-of-low-value-goods
 */
@Injectable()
export class SgGstResolverService {
  private static readonly STANDARD_RATE = 0.09;

  /** SGD threshold for OVR scheme — at or below: GST collected at PoS. */
  static readonly LVIG_SGD = 400;

  compute(dutyPaidValueSgd: number): {
    rate: number;
    amount: number;
    note: string;
  } {
    const amount = dutyPaidValueSgd * SgGstResolverService.STANDARD_RATE;
    return {
      rate: SgGstResolverService.STANDARD_RATE,
      amount,
      note: 'Singapore GST 9% on customs-duty-paid CIF value (IRAS)',
    };
  }

  /**
   * Returns true when the shipment is in scope for the OVR scheme — GST
   * is collected at point-of-sale by the offshore registered supplier,
   * not at the border. Calculator should NOT charge GST in that case.
   */
  isLvigOvr(declaredValueSgd: number): boolean {
    return declaredValueSgd <= SgGstResolverService.LVIG_SGD;
  }

  lvigThreshold(): number {
    return SgGstResolverService.LVIG_SGD;
  }
}
