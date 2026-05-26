import { Injectable } from '@nestjs/common';

/**
 * KrVatResolverService
 *
 * Korea VAT (부가가치세, "Value-added tax") on imports.
 *   - Standard rate: 10%
 *   - Base: customs-duty-paid CIF value (declared value + duty + shipping + insurance)
 *   - De minimis: personal-use parcels ≤ KRW 150,000 (express clearance) or
 *     KRW 200,000 are exempted from duty + VAT. Above that threshold, duty
 *     and VAT apply on the full CIF value (not just the excess).
 *
 * Source: National Tax Service (NTS) https://www.nts.go.kr/english/main.do
 */
@Injectable()
export class KrVatResolverService {
  private static readonly STANDARD_RATE = 0.1;

  /** KRW threshold for personal-use express clearance (전자상거래물품). */
  static readonly DE_MINIMIS_KRW = 200_000;

  compute(dutyPaidValueKrw: number): {
    rate: number;
    amount: number;
    note: string;
  } {
    const amount = dutyPaidValueKrw * KrVatResolverService.STANDARD_RATE;
    return {
      rate: KrVatResolverService.STANDARD_RATE,
      amount,
      note: 'Korea VAT 10% on customs-duty-paid CIF value (NTS)',
    };
  }

  isLowValueExempt(declaredValueKrw: number): boolean {
    return declaredValueKrw <= KrVatResolverService.DE_MINIMIS_KRW;
  }

  deMinimisThreshold(): number {
    return KrVatResolverService.DE_MINIMIS_KRW;
  }
}
