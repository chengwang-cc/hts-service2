import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '@hts/core';
import { TariffSelectionMode } from '../../calculator/dto/calculate.dto';

/**
 * IncompleteCodeFallbackService (P3.3)
 *
 * Given a 6-digit HS code and a tariff-selection mode, picks a specific
 * deep code (e.g., the US 10-digit, GB 10-digit) so the landed-cost
 * resolver has something concrete to evaluate against. Surfaces a
 * warning the caller should attach to the line.
 */
@Injectable()
export class IncompleteCodeFallbackService {
  private readonly logger = new Logger(IncompleteCodeFallbackService.name);
  private readonly confidencePenalty = 0.25;

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepo: Repository<HtsEntity>,
  ) {}

  async selectDeepCode(args: {
    hs6: string;
    destinationCountry: string;
    mode: TariffSelectionMode;
  }): Promise<{
    htsNumber: string | null;
    warning: string | null;
    confidencePenalty: number;
  }> {
    const hs6 = (args.hs6 || '').replace(/\D/g, '').slice(0, 6);
    if (hs6.length !== 6) {
      return {
        htsNumber: null,
        warning: 'HS6 code must be 6 digits',
        confidencePenalty: 0,
      };
    }

    // P3 ships US-only deep code lookup. Other jurisdictions get plugged in
    // by their respective adapters.
    if (args.destinationCountry.toUpperCase() !== 'US') {
      return {
        htsNumber: null,
        warning: `Incomplete-code fallback for ${args.destinationCountry} not yet supported`,
        confidencePenalty: 0,
      };
    }

    const candidates = await this.htsRepo
      .createQueryBuilder('hts')
      .select(['hts.htsNumber', 'hts.rateFormula', 'hts.generalRate'])
      .where(`REGEXP_REPLACE(hts.htsNumber, '[^0-9]', '', 'g') LIKE :p`, {
        p: `${hs6}%`,
      })
      .andWhere('hts.isActive = true')
      .andWhere(`LENGTH(REGEXP_REPLACE(hts.htsNumber, '[^0-9]', '', 'g')) >= 8`)
      .orderBy('hts.htsNumber', 'ASC')
      .limit(50)
      .getMany();

    if (candidates.length === 0) {
      return {
        htsNumber: null,
        warning: `No deep code found for HS6 ${hs6}`,
        confidencePenalty: 0,
      };
    }

    // Quick parser: pull leading-percent or absolute rate out of the
    // generalRate text so we can rank without evaluating formulas.
    const ratesByCode = new Map<string, number>();
    for (const c of candidates) {
      const r = this.extractAdValoremRate(c.generalRate);
      ratesByCode.set(c.htsNumber, r);
    }

    let chosen: string | undefined;
    switch (args.mode) {
      case 'maximum':
        chosen = this.pickByStat(ratesByCode, 'max');
        break;
      case 'minimum':
        chosen = this.pickByStat(ratesByCode, 'min');
        break;
      case 'median':
        chosen = this.pickByStat(ratesByCode, 'median');
        break;
      case 'preferred':
      default:
        // Default: deepest (most-specific) code with a parseable rate;
        // ties broken by lowest htsNumber.
        chosen = candidates
          .filter((c) => !!c.generalRate)
          .sort((a, b) => a.htsNumber.localeCompare(b.htsNumber))[0]
          ?.htsNumber;
        break;
    }

    if (!chosen) {
      chosen = candidates[0].htsNumber;
    }

    return {
      htsNumber: chosen,
      warning: `INCOMPLETE_HS_FALLBACK_${args.mode.toUpperCase()}: selected ${chosen} from ${candidates.length} HS6=${hs6} candidates`,
      confidencePenalty: this.confidencePenalty,
    };
  }

  private extractAdValoremRate(text: string | null | undefined): number {
    if (!text) return 0;
    const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return parseFloat(m[1]);
    if (/free/i.test(text)) return 0;
    return 0;
  }

  private pickByStat(
    rates: Map<string, number>,
    mode: 'max' | 'min' | 'median',
  ): string | undefined {
    const arr = Array.from(rates.entries());
    if (arr.length === 0) return undefined;
    arr.sort((a, b) => a[1] - b[1]);
    if (mode === 'min') return arr[0][0];
    if (mode === 'max') return arr[arr.length - 1][0];
    return arr[Math.floor(arr.length / 2)][0];
  }
}
