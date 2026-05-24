import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExchangeRateSnapshotEntity } from '../entities/exchange-rate-snapshot.entity';

/**
 * CurrencyConversionService (P3.1)
 *
 * Resolves an exchange rate for a `(from, to, date)` triple by reading
 * the most-recent ExchangeRateSnapshotEntity at-or-before the entry date.
 * Falls back to 1:1 with a warning when no snapshot covers the date.
 *
 * Snapshots are populated out-of-band (e.g., daily ECB feed); landed-cost
 * does not fetch live rates on the request path.
 */
@Injectable()
export class CurrencyConversionService {
  private readonly logger = new Logger(CurrencyConversionService.name);

  constructor(
    @InjectRepository(ExchangeRateSnapshotEntity)
    private readonly snapshotRepo: Repository<ExchangeRateSnapshotEntity>,
  ) {}

  async convert(args: {
    from: string;
    to: string;
    amount: number;
    effectiveDate?: string;
  }): Promise<{ amount: number; rate: number; snapshotId: string | null; warning: string | null }> {
    const from = (args.from || '').toUpperCase();
    const to = (args.to || '').toUpperCase();
    if (from === to) {
      return { amount: args.amount, rate: 1, snapshotId: null, warning: null };
    }

    const snapshot = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.effectiveDate <= :d', {
        d: args.effectiveDate || new Date().toISOString().slice(0, 10),
      })
      .orderBy('s.effectiveDate', 'DESC')
      .limit(1)
      .getOne();

    if (!snapshot) {
      this.logger.warn(
        `No exchange-rate snapshot for ${from}->${to}; falling back to 1:1`,
      );
      return {
        amount: args.amount,
        rate: 1,
        snapshotId: null,
        warning: `MISSING_EXCHANGE_RATE_SNAPSHOT_${from}_TO_${to}`,
      };
    }

    const key = `${from}->${to}`;
    const inverseKey = `${to}->${from}`;
    let rate = snapshot.rates[key];
    if (rate === undefined && snapshot.rates[inverseKey]) {
      rate = 1 / snapshot.rates[inverseKey];
    }
    if (rate === undefined) {
      // Triangulate via USD if both legs exist.
      const fromToUsd = snapshot.rates[`${from}->USD`];
      const usdToTarget = snapshot.rates[`USD->${to}`];
      if (fromToUsd && usdToTarget) {
        rate = fromToUsd * usdToTarget;
      }
    }
    if (rate === undefined) {
      return {
        amount: args.amount,
        rate: 1,
        snapshotId: snapshot.id,
        warning: `MISSING_RATE_PAIR_${key}`,
      };
    }

    return {
      amount: this.round2(args.amount * rate),
      rate,
      snapshotId: snapshot.id,
      warning: null,
    };
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }
}
