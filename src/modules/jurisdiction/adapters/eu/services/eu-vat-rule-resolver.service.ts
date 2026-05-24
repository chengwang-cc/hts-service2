import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaxRuleEntity } from '../../../entities';

/**
 * Per-Member-State standard VAT rate fallback (effective 2026-05).
 * Used only when no TaxRuleEntity row exists for the destination yet.
 * Authoritative source: TEDB (Taxes in Europe Database) maintained by
 * the European Commission.
 */
const DEFAULT_STANDARD_VAT_BY_MS: Record<string, number> = {
  AT: 0.2,
  BE: 0.21,
  BG: 0.2,
  HR: 0.25,
  CY: 0.19,
  CZ: 0.21,
  DK: 0.25,
  EE: 0.22,
  FI: 0.255,
  FR: 0.2,
  DE: 0.19,
  GR: 0.24,
  HU: 0.27,
  IE: 0.23,
  IT: 0.22,
  LV: 0.21,
  LT: 0.21,
  LU: 0.17,
  MT: 0.18,
  NL: 0.21,
  PL: 0.23,
  PT: 0.23,
  RO: 0.19,
  SK: 0.23,
  SI: 0.22,
  ES: 0.21,
  SE: 0.25,
};

export interface EuVatDecision {
  memberState: string;
  rate: number;
  source: 'tax_rule_entity' | 'default_table';
  sourceCitationId: string | null;
}

@Injectable()
export class EuVatRuleResolverService {
  private readonly logger = new Logger(EuVatRuleResolverService.name);

  constructor(
    @InjectRepository(TaxRuleEntity)
    private readonly taxRepo: Repository<TaxRuleEntity>,
  ) {}

  async resolveStandard(memberState: string, effectiveDate?: string): Promise<EuVatDecision> {
    const ms = (memberState || '').toUpperCase();
    const date = effectiveDate || new Date().toISOString().slice(0, 10);

    const row = await this.taxRepo
      .createQueryBuilder('t')
      .where('t.jurisdictionCode = :j', { j: 'EU' })
      .andWhere('t.memberStateCode = :ms', { ms })
      .andWhere('t.taxType = :type', { type: 'VAT' })
      .andWhere('t.effectiveFrom <= :d', { d: date })
      .andWhere('(t.effectiveTo IS NULL OR t.effectiveTo >= :d)', { d: date })
      .orderBy('t.rate', 'DESC') // standard is the highest active rate
      .limit(1)
      .getOne();

    if (row) {
      return {
        memberState: ms,
        rate: Number(row.rate),
        source: 'tax_rule_entity',
        sourceCitationId: row.sourceCitationId ?? null,
      };
    }

    const fallback = DEFAULT_STANDARD_VAT_BY_MS[ms];
    if (fallback === undefined) {
      this.logger.warn(`No standard VAT rate known for EU member state ${ms}`);
      return { memberState: ms, rate: 0, source: 'default_table', sourceCitationId: null };
    }
    return {
      memberState: ms,
      rate: fallback,
      source: 'default_table',
      sourceCitationId: null,
    };
  }
}
