import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FxRecordEntity } from './entities/fx-record.entity';
import type { FxRecord, FxStore } from './fx-record.service';

/**
 * TypeORM-backed implementation of `FxStore`. Persists FX snapshots in the
 * `fx_records` table; reads recent records for a quote on demand.
 *
 * Production wires this into FxRecordService via `configureStore()` so
 * audit FX records survive a restart. Dev / unit tests keep using the
 * in-memory ring buffer fallback.
 */
@Injectable()
export class TypeOrmFxStore implements FxStore {
  private readonly logger = new Logger(TypeOrmFxStore.name);

  constructor(
    @InjectRepository(FxRecordEntity)
    private readonly repo: Repository<FxRecordEntity>,
  ) {}

  async write(record: FxRecord): Promise<void> {
    const row = this.repo.create({
      id: record.id.startsWith('fx_') ? record.id.slice(3) : record.id,
      quoteId: record.quoteId,
      fromCurrency: record.fromCurrency,
      toCurrency: record.toCurrency,
      rate: record.rate,
      provider: record.provider,
      observedAt: record.observedAt,
    });
    try {
      await this.repo.save(row);
    } catch (e: any) {
      // Audit must never block the calculator path.
      this.logger.warn(`fx_records insert failed: ${e?.message}`);
    }
  }

  async recent(quoteId: string): Promise<FxRecord[]> {
    const rows = await this.repo.find({
      where: { quoteId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return rows.map((r) => ({
      id: `fx_${r.id}`,
      quoteId: r.quoteId,
      fromCurrency: r.fromCurrency,
      toCurrency: r.toCurrency,
      rate: Number(r.rate),
      provider: r.provider,
      observedAt: r.observedAt,
    }));
  }
}
