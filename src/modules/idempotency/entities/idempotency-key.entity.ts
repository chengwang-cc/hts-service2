import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * One row per (scope, key, requestHash) triple seen by the
 * IdempotencyInterceptor. Lookups happen by `(scope, key)` only — the
 * `requestHash` field is stored separately so a replay with a different
 * body under the SAME key can 409 instead of silently returning the
 * cached response (Stripe's documented behavior on Idempotency-Key
 * mismatches).
 *
 * `responseBody` stores the JSON-serialised response so a replay
 * returns BYTE-for-byte the same payload as the original. This is the
 * contract: an `Idempotency-Key` retry MUST be indistinguishable from
 * a successful first request, including any client-side ids the server
 * generated (job id, queue position, etc.).
 *
 * TTL: 24 hours from `createdAt`. The interceptor checks expiry on
 * read; a separate sweeper (out-of-scope here — out-of-the-box `pg`
 * partial-index trick works fine) removes stale rows.
 */
@Entity('idempotency_keys')
@Index(['scope', 'key'], { unique: true })
@Index(['createdAt'])
export class IdempotencyKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Logical namespace for the key — e.g. 'batch.jobs.create',
   * 'calculator.calculate.batch'. Separates keys across endpoints so a
   * client can reuse "key-of-the-day" between unrelated operations
   * without collisions.
   */
  @Column('varchar', { length: 64 })
  scope: string;

  @Column('varchar', { length: 255 })
  key: string;

  /**
   * Stable hash of the canonical request (method + path + body). Used
   * to detect "same key, different body" replays and surface a 409
   * rather than returning a stale, misleading response.
   */
  @Column('varchar', { length: 64, name: 'request_hash' })
  requestHash: string;

  /** Optional org scoping. NULL for guest / public endpoints. */
  @Column('uuid', { name: 'organization_id', nullable: true })
  organizationId: string | null;

  @Column('int', { name: 'status_code' })
  statusCode: number;

  @Column('jsonb', { name: 'response_body' })
  responseBody: unknown;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
