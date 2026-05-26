import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * FxRecordEntity (Phase F2)
 *
 * Audit row recording the FX rate applied to a cross-currency calculator
 * quote. One row per (quoteId, fromCurrency, toCurrency) snapshot.
 *
 * The TypeORM-backed store wraps this entity behind the `FxStore` port the
 * FxRecordService consumes; the in-memory fallback in dev/test uses the
 * same shape.
 *
 * To materialize this table in the production schema, run
 *   scripts/generate-migration.sh fx-records
 * then
 *   scripts/run-migration.sh
 */
@Entity('fx_records')
@Index(['quoteId', 'observedAt'])
export class FxRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Quote id this FX record is attached to (`quote_<uuid>`). */
  @Column('varchar', { length: 100 })
  quoteId: string;

  /** ISO 4217 source currency of the request. */
  @Column('varchar', { length: 3 })
  fromCurrency: string;

  /** ISO 4217 destination currency for the quote. */
  @Column('varchar', { length: 3 })
  toCurrency: string;

  /** Applied FX rate (multiply `fromCurrency` amount by this to get `toCurrency`). */
  @Column('decimal', { precision: 18, scale: 8 })
  rate: number;

  /** Provider tag (e.g. `frankfurter`, `adapter_inline`, `manual`). */
  @Column('varchar', { length: 50, default: 'unknown' })
  provider: string;

  /** ISO timestamp the rate was observed at upstream (not when we wrote it). */
  @Column('varchar', { length: 32 })
  observedAt: string;

  @CreateDateColumn()
  createdAt: Date;
}
