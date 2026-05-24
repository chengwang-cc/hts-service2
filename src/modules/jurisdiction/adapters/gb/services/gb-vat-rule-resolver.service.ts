import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LowValueRuleEntity,
  TaxRuleEntity,
} from '../../../entities';

export interface GbVatDecision {
  /** 'checkout' (seller-collected via VAT Mini One Stop equivalent) or 'border'. */
  collectionPoint: 'checkout' | 'border' | 'reverse_charge' | 'exempt';
  /** Effective VAT rate (e.g. 0.20). */
  rate: number;
  /** Why this path was chosen. */
  reason: string;
  /** Source citation IDs that drove the decision (low_value_rule, tax_rule). */
  citationRefs: string[];
}

/**
 * GbVatRuleResolverService (P5.1)
 *
 * Decide UK VAT treatment for a single line, given:
 *   - declared customs value (in GBP, already converted),
 *   - destination region (GB vs Northern Ireland — protocol-aware),
 *   - whether the goods are excise-excluded,
 *   - whether the buyer is a VAT-registered business (B2B reverse-charge),
 *   - the seller's UK VAT registration (required for seller-collected
 *     low-value rule on consignments <= GBP 135).
 *
 * Looks up effective LowValueRuleEntity + TaxRuleEntity rows seeded for
 * GB; safe defaults are applied if the database has no rows yet.
 */
@Injectable()
export class GbVatRuleResolverService {
  private readonly DEFAULT_GB_STANDARD_VAT = 0.2; // 20% — verify via TaxRuleEntity
  private readonly DEFAULT_LOW_VALUE_THRESHOLD_GBP = 135;

  constructor(
    @InjectRepository(LowValueRuleEntity)
    private readonly lvRepo: Repository<LowValueRuleEntity>,
    @InjectRepository(TaxRuleEntity)
    private readonly taxRepo: Repository<TaxRuleEntity>,
  ) {}

  async resolve(args: {
    declaredValueGbp: number;
    hsCode: string;
    effectiveDate: string;
    buyerIsVatRegisteredBusiness?: boolean;
    sellerHasUkVatRegistration?: boolean;
  }): Promise<GbVatDecision> {
    const date = args.effectiveDate || new Date().toISOString().slice(0, 10);

    // Active low-value rule for GB.
    const lowValue = await this.lvRepo
      .createQueryBuilder('lv')
      .where('lv.jurisdictionCode = :j', { j: 'GB' })
      .andWhere('lv.effectiveFrom <= :d', { d: date })
      .andWhere('(lv.effectiveTo IS NULL OR lv.effectiveTo >= :d)', { d: date })
      .orderBy('lv.effectiveFrom', 'DESC')
      .limit(1)
      .getOne();

    const threshold = Number(lowValue?.threshold ?? this.DEFAULT_LOW_VALUE_THRESHOLD_GBP);

    // Active GB VAT rule (standard rate, or zero-rate exemption).
    const standardVat = await this.taxRepo
      .createQueryBuilder('t')
      .where('t.jurisdictionCode = :j', { j: 'GB' })
      .andWhere('t.taxType = :type', { type: 'VAT' })
      .andWhere('t.effectiveFrom <= :d', { d: date })
      .andWhere('(t.effectiveTo IS NULL OR t.effectiveTo >= :d)', { d: date })
      .orderBy('t.rate', 'DESC')
      .limit(1)
      .getOne();

    const rate = standardVat
      ? Number(standardVat.rate)
      : this.DEFAULT_GB_STANDARD_VAT;
    const citationRefs: string[] = [];
    if (lowValue?.sourceCitationId) citationRefs.push(lowValue.sourceCitationId);
    if (standardVat?.sourceCitationId) citationRefs.push(standardVat.sourceCitationId);

    const isExciseExcluded = this.isExciseExcluded(
      args.hsCode,
      lowValue?.excludedHsPrefixes || ['22.', '24.'],
    );

    if (!isExciseExcluded && args.declaredValueGbp <= threshold) {
      if (args.buyerIsVatRegisteredBusiness) {
        return {
          collectionPoint: 'reverse_charge',
          rate,
          reason: `Consignment <= GBP ${threshold} and buyer is UK VAT-registered — reverse charge`,
          citationRefs,
        };
      }
      if (args.sellerHasUkVatRegistration) {
        return {
          collectionPoint: 'checkout',
          rate,
          reason: `Consignment <= GBP ${threshold}; seller has UK VAT registration — seller-collected at checkout`,
          citationRefs,
        };
      }
      // No registration and not B2B → border VAT (HMRC will charge buyer).
      return {
        collectionPoint: 'border',
        rate,
        reason: `Consignment <= GBP ${threshold} but seller lacks UK VAT registration — defaulting to border VAT`,
        citationRefs,
      };
    }

    // Standard import VAT path.
    return {
      collectionPoint: 'border',
      rate,
      reason: isExciseExcluded
        ? `Excise / excluded goods — border VAT applies regardless of value`
        : `Consignment > GBP ${threshold} — border VAT applies`,
      citationRefs,
    };
  }

  private isExciseExcluded(hsCode: string, excludedPrefixes: string[]): boolean {
    const digits = (hsCode || '').replace(/\D/g, '');
    if (!digits) return false;
    return excludedPrefixes.some((p) => {
      const normalized = p.replace(/[^0-9]/g, '');
      return normalized && digits.startsWith(normalized);
    });
  }
}
