import { Injectable } from '@nestjs/common';

export interface EuIossDecision {
  /** 'checkout' (IOSS — seller collects, remits via IOSS), 'border', 'reverse_charge', or 'exempt'. */
  collectionPoint: 'checkout' | 'border' | 'reverse_charge' | 'exempt';
  reason: string;
}

/**
 * EuIossResolverService
 *
 * Implements the EU low-value VAT decision tree:
 *
 *   • Excise goods (HS 22 / 24 alcohol, tobacco) → border (not IOSS-eligible).
 *   • B2B sale with buyer's VAT id → reverse-charge (no checkout VAT).
 *   • Cart customs value <= EUR 150 AND seller has IOSS number →
 *     checkout collection (IOSS).
 *   • Cart customs value <= EUR 150 AND marketplace deemed-supplier →
 *     checkout via marketplace's IOSS.
 *   • Else → border VAT.
 *
 * Sources:
 *   - https://vat-one-stop-shop.ec.europa.eu/index_en
 *   - https://taxation-customs.ec.europa.eu/taxation/vat_en
 */
@Injectable()
export class EuIossResolverService {
  private readonly THRESHOLD_EUR = 150;
  private readonly EXCLUDED_HS_PREFIXES = ['22', '24'];

  decide(args: {
    declaredValueEur: number;
    hsCode: string;
    sellerIossNumber?: string | null;
    sellerIsMarketplace?: boolean;
    buyerType?: 'consumer' | 'business';
    buyerVatId?: string;
  }): EuIossDecision {
    const digits = (args.hsCode || '').replace(/\D/g, '');
    const hsPrefix = digits.slice(0, 2);
    const isExcise = this.EXCLUDED_HS_PREFIXES.includes(hsPrefix);

    if (
      args.buyerType === 'business' &&
      args.buyerVatId &&
      /^[A-Z]{2}/.test(args.buyerVatId)
    ) {
      return {
        collectionPoint: 'reverse_charge',
        reason: 'B2B with valid-format EU VAT id — reverse charge',
      };
    }

    if (isExcise) {
      return {
        collectionPoint: 'border',
        reason: `Excise goods (HS ${hsPrefix}xxxx) — IOSS not applicable`,
      };
    }

    if (args.declaredValueEur > this.THRESHOLD_EUR) {
      return {
        collectionPoint: 'border',
        reason: `Cart > EUR ${this.THRESHOLD_EUR} — border VAT applies`,
      };
    }

    if (args.sellerIossNumber) {
      return {
        collectionPoint: 'checkout',
        reason: `Cart <= EUR ${this.THRESHOLD_EUR} with seller IOSS number — checkout VAT`,
      };
    }

    if (args.sellerIsMarketplace) {
      return {
        collectionPoint: 'checkout',
        reason: `Cart <= EUR ${this.THRESHOLD_EUR} via deemed-supplier marketplace — checkout VAT (marketplace IOSS)`,
      };
    }

    return {
      collectionPoint: 'border',
      reason: `Cart <= EUR ${this.THRESHOLD_EUR} but no IOSS registration — border VAT defaults`,
    };
  }
}
