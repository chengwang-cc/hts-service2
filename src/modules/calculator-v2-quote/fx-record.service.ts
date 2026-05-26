import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * FxRecordService (Phase F2)
 *
 * Captures the exchange rate used for any cross-currency calculator quote
 * so audit can later answer "what rate did we apply, when, from what
 * provider?". Persistence is dependency-injected via the `FxStore` port —
 * production wires a TypeORM-backed store (table `fx_records`) once the
 * migration lands; tests + dev use the in-memory ring-buffer default.
 *
 * The contract is intentionally narrow: record one snapshot per (from, to,
 * quoteId) call, log it, return the record. Consumers don't decide how it's
 * stored.
 *
 * To materialize the production store, run
 *   scripts/generate-migration.sh fx-records
 * and add a TypeORM-backed `FxStore` to CalculatorV2QuoteModule providers.
 */

export interface FxRecord {
  id: string;
  quoteId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  provider: string;
  observedAt: string;
}

export interface FxStore {
  write(record: FxRecord): Promise<void> | void;
  recent(quoteId: string): Promise<FxRecord[]> | FxRecord[];
}

/**
 * Bounded in-memory ring buffer. Good enough for dev + tests. Drops old
 * records once the cap is hit; nothing here is durable across restarts.
 */
class InMemoryFxStore implements FxStore {
  private readonly buf: FxRecord[] = [];
  private readonly cap = 1000;

  write(record: FxRecord): void {
    this.buf.push(record);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  recent(quoteId: string): FxRecord[] {
    return this.buf.filter((r) => r.quoteId === quoteId);
  }
}

@Injectable()
export class FxRecordService {
  private readonly logger = new Logger(FxRecordService.name);
  private store: FxStore = new InMemoryFxStore();

  /** Swap in a TypeORM-backed (or any) FxStore at boot. */
  configureStore(store: FxStore): void {
    this.store = store;
  }

  /**
   * Record an FX observation. When `from === to`, the record is noop and
   * the call is logged but not stored (a same-currency quote has no FX
   * exposure to audit).
   */
  async record(args: {
    quoteId: string;
    fromCurrency: string;
    toCurrency: string;
    rate: number;
    provider?: string;
  }): Promise<FxRecord | null> {
    const from = (args.fromCurrency || '').toUpperCase();
    const to = (args.toCurrency || '').toUpperCase();
    if (!from || !to) return null;
    if (from === to) {
      this.logger.debug(
        `fx.record skipped: quote=${args.quoteId} same currency ${from}`,
      );
      return null;
    }
    const record: FxRecord = {
      id: `fx_${randomUUID()}`,
      quoteId: args.quoteId,
      fromCurrency: from,
      toCurrency: to,
      rate: args.rate,
      provider: args.provider || 'unknown',
      observedAt: new Date().toISOString(),
    };
    try {
      await this.store.write(record);
    } catch (e: any) {
      // FX records are audit-only; never block the calculator path.
      this.logger.warn(`fx.record store write failed: ${e?.message}`);
    }
    this.logger.log(
      `fx.record quote=${args.quoteId} ${from}->${to} rate=${args.rate} provider=${record.provider}`,
    );
    return record;
  }

  async recent(quoteId: string): Promise<FxRecord[]> {
    const out = await this.store.recent(quoteId);
    return Array.isArray(out) ? out : [];
  }
}
