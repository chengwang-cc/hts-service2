import { Injectable } from '@nestjs/common';

/**
 * TwBusinessTaxResolverService
 *
 * Taiwan Business Tax (營業稅 / "Business Tax") on imports — equivalent
 * to VAT in other jurisdictions.
 *   - Standard rate: 5%
 *   - Base: customs-duty-paid CIF value (declared + duty + shipping + insurance)
 *   - De minimis: personal-use parcels ≤ TWD 2,000 are exempt from both
 *     duty AND Business Tax, subject to frequency restrictions (max 6
 *     parcels per importer per 6-month window — not modeled here).
 *
 * Source: Ministry of Finance — https://web.customs.gov.tw/EN
 */
@Injectable()
export class TwBusinessTaxResolverService {
  private static readonly STANDARD_RATE = 0.05;

  static readonly DE_MINIMIS_TWD = 2_000;

  compute(dutyPaidValueTwd: number): { rate: number; amount: number; note: string } {
    const amount = dutyPaidValueTwd * TwBusinessTaxResolverService.STANDARD_RATE;
    return {
      rate: TwBusinessTaxResolverService.STANDARD_RATE,
      amount,
      note: 'Taiwan Business Tax 5% on customs-duty-paid CIF value (MOF)',
    };
  }

  isDeMinimisExempt(declaredValueTwd: number): boolean {
    return declaredValueTwd <= TwBusinessTaxResolverService.DE_MINIMIS_TWD;
  }

  deMinimisThreshold(): number {
    return TwBusinessTaxResolverService.DE_MINIMIS_TWD;
  }
}
