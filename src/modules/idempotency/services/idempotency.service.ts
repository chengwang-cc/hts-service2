import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { IdempotencyKeyEntity } from '../entities/idempotency-key.entity';

export interface CachedResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Persistence layer for `Idempotency-Key` replay protection.
 *
 * The contract this enforces:
 *
 *   - SAME (scope, key, requestHash) → return the cached response
 *     byte-for-byte. The replay sees no side-effects beyond the first
 *     call.
 *   - SAME (scope, key), DIFFERENT requestHash → 409 Conflict. Reusing
 *     a key against a different body is almost certainly a client bug
 *     (e.g. token reuse across endpoints); we'd rather surface it than
 *     silently return a stale response from the original call.
 *   - NEW (scope, key) → returns null; caller proceeds with the actual
 *     work, then calls `save()` with the response so future replays
 *     hit the cache.
 *
 * TTL: 24 hours from `createdAt`. Enforced on read (`isExpired`)
 * rather than via DB cleanup so a slow sweeper can't open a window of
 * "stale row returned as a hit". A separate cron clears expired rows;
 * the read path itself never trusts an old row.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(IdempotencyKeyEntity)
    private readonly repo: Repository<IdempotencyKeyEntity>,
  ) {}

  /**
   * Stable, order-insensitive hash of the canonical request. We sort
   * object keys before stringifying so two semantically-identical
   * payloads in different key order produce the same hash. (JSON.stringify
   * preserves insertion order, which would otherwise let a malicious or
   * sloppy client bypass the same-body check.)
   */
  hashRequest(method: string, path: string, body: unknown): string {
    const canonical = JSON.stringify({
      method: method.toUpperCase(),
      path,
      body: this.canonicalize(body),
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Returns the cached response if the (scope, key, requestHash) tuple
   * matches an existing non-expired row. Throws 409 if the key exists
   * but with a different request hash.
   */
  async lookup(params: {
    scope: string;
    key: string;
    requestHash: string;
  }): Promise<CachedResponse | null> {
    const row = await this.repo.findOne({
      where: { scope: params.scope, key: params.key },
    });
    if (!row) return null;
    if (this.isExpired(row)) {
      // Best-effort: trim the stale row so the caller can reuse the
      // key fresh. A concurrent insert would race with this delete but
      // the unique constraint catches it.
      await this.repo.delete({ id: row.id }).catch(() => undefined);
      return null;
    }
    if (row.requestHash !== params.requestHash) {
      this.logger.warn(
        `[idempotency] (${params.scope}, ${params.key}) reused with a different body`,
      );
      throw new ConflictException(
        'Idempotency-Key was already used with a different request body',
      );
    }
    return { statusCode: row.statusCode, body: row.responseBody };
  }

  /**
   * Persist the response under (scope, key, requestHash). If a row
   * with this (scope, key) was inserted concurrently (race during the
   * gap between lookup and the actual work), the unique constraint
   * fires — we swallow it because the cached value will win on the
   * NEXT replay; one extra side-effect for the racing pair is an
   * acceptable failure mode.
   */
  async save(params: {
    scope: string;
    key: string;
    requestHash: string;
    organizationId: string | null;
    statusCode: number;
    body: unknown;
  }): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          scope: params.scope,
          key: params.key,
          requestHash: params.requestHash,
          organizationId: params.organizationId,
          statusCode: params.statusCode,
          responseBody: params.body,
        }),
      );
    } catch (err) {
      // Race-window duplicate insert — log + ignore. The persisted
      // row from the winning request is the one future replays see.
      this.logger.debug(
        `[idempotency] save raced for (${params.scope}, ${params.key}): ${(err as Error)?.message}`,
      );
    }
  }

  private isExpired(row: IdempotencyKeyEntity): boolean {
    return Date.now() - row.createdAt.getTime() > this.TTL_MS;
  }

  /**
   * Sort object keys recursively so the hash is stable across
   * semantically-identical payloads in different key order. Arrays
   * preserve order (item order matters — a batch's first item is not
   * interchangeable with its second).
   */
  private canonicalize(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => this.canonicalize(v));
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = this.canonicalize(obj[k]);
        return acc;
      }, {});
  }
}
