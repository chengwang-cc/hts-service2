import { Injectable } from '@nestjs/common';

/**
 * Provincial sales-tax table (effective 2026-05). Source: CRA + provincial
 * ministry publications. HST = combined GST + PVAT collected by CRA.
 * PST/QST/RST are collected provincially and apply to *most* taxable
 * imports though several categories are exempt.
 */
const PROVINCE_TAXES: Record<
  string,
  {
    name: string;
    gst: number; // federal GST
    pst: number; // provincial sales tax (PST / QST / RST)
    hst: number; // harmonized — when non-zero, GST + PST are ignored at point of import
  }
> = {
  AB: { name: 'Alberta', gst: 0.05, pst: 0, hst: 0 },
  BC: { name: 'British Columbia', gst: 0.05, pst: 0.07, hst: 0 },
  MB: { name: 'Manitoba', gst: 0.05, pst: 0.07, hst: 0 },
  NB: { name: 'New Brunswick', gst: 0, pst: 0, hst: 0.15 },
  NL: { name: 'Newfoundland and Labrador', gst: 0, pst: 0, hst: 0.15 },
  NS: { name: 'Nova Scotia', gst: 0, pst: 0, hst: 0.15 },
  NT: { name: 'Northwest Territories', gst: 0.05, pst: 0, hst: 0 },
  NU: { name: 'Nunavut', gst: 0.05, pst: 0, hst: 0 },
  ON: { name: 'Ontario', gst: 0, pst: 0, hst: 0.13 },
  PE: { name: 'Prince Edward Island', gst: 0, pst: 0, hst: 0.15 },
  QC: { name: 'Quebec', gst: 0.05, pst: 0.09975, hst: 0 }, // QST 9.975%
  SK: { name: 'Saskatchewan', gst: 0.05, pst: 0.06, hst: 0 },
  YT: { name: 'Yukon', gst: 0.05, pst: 0, hst: 0 },
};

export interface CaTaxBreakdown {
  province: string;
  base: number;
  components: Array<{ type: 'GST' | 'HST' | 'PST' | 'QST' | 'RST'; rate: number; amount: number }>;
  totalTax: number;
  warnings: string[];
}

/**
 * CaGstHstResolverService
 *
 * Computes Canadian point-of-import sales taxes (GST / HST / PST / QST /
 * RST) on the duty-paid value (CIF + duty). At the border, CBSA collects
 * GST + HST; PST/QST/RST are *generally* collected provincially but for
 * casual / personal imports CBSA also collects on behalf of provinces
 * via the Courier Low-Value Shipment programme. We compute the *full*
 * obligation here and let the caller decide which line items go to
 * "fees" (border-collected) vs "taxes" (provincial) for display.
 */
@Injectable()
export class CaGstHstResolverService {
  /**
   * @param dutyPaidValue customs value + duty + (optionally) excise.
   * @param province two-letter province code, optional. If omitted we
   *        assume the federal 5% GST only (a reasonable default when the
   *        merchant doesn't supply a delivery province).
   */
  compute(dutyPaidValue: number, province?: string): CaTaxBreakdown {
    const warnings: string[] = [];
    let code = (province || '').trim().toUpperCase();
    if (!code) {
      warnings.push('CA_NO_PROVINCE: defaulted to federal GST 5% only');
      code = '__DEFAULT__';
    }
    const taxes =
      PROVINCE_TAXES[code] ||
      ({ name: 'Default (GST only)', gst: 0.05, pst: 0, hst: 0 } as const);

    const components: CaTaxBreakdown['components'] = [];
    if (taxes.hst > 0) {
      components.push({
        type: 'HST',
        rate: taxes.hst,
        amount: round2(dutyPaidValue * taxes.hst),
      });
    } else {
      if (taxes.gst > 0) {
        components.push({
          type: 'GST',
          rate: taxes.gst,
          amount: round2(dutyPaidValue * taxes.gst),
        });
      }
      if (taxes.pst > 0) {
        const type =
          code === 'QC' ? 'QST' : code === 'MB' ? 'RST' : 'PST';
        components.push({
          type,
          rate: taxes.pst,
          amount: round2(dutyPaidValue * taxes.pst),
        });
      }
    }

    const totalTax = components.reduce((s, c) => s + c.amount, 0);
    return {
      province: code === '__DEFAULT__' ? '' : code,
      base: round2(dutyPaidValue),
      components,
      totalTax: round2(totalTax),
      warnings,
    };
  }

  listProvinces(): string[] {
    return Object.keys(PROVINCE_TAXES);
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
