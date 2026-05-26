import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { IEmbeddingService } from '../interfaces/embedding.interface';
import { OpenAiService } from './openai.service';

export type EmbeddingProvider = 'openai';

export interface EmbeddingProviderConfig {
  /** Active provider name — OpenAI-only after the DGX retirement. */
  provider: EmbeddingProvider;
  /** Vector dimension for the active provider (1536 for text-embedding-3-small). */
  dimension: number;
  /**
   * PostgreSQL column name (snake_case) for use in raw pgvector SQL expressions,
   * e.g. `addSelect('1 - (hts.embedding_openai <=> :v)', 'similarity')`.
   * TypeORM passes complex addSelect expressions through as raw SQL — it does
   * NOT resolve the alias.column reference through the NamingStrategy here.
   *
   * Always `embedding_openai` (vector(1536)) after the DGX retirement.
   */
  column: 'embedding_openai';
  /**
   * TypeORM entity property name (camelCase) for use in QueryBuilder
   * where / andWhere / orderBy / select clauses. NamingStrategy resolves
   * this to `embedding_openai`. Using the snake_case column here would
   * fail with `TypeError: Cannot read properties of undefined (reading
   * 'databaseName')`.
   */
  property: 'embeddingOpenai';
}

/**
 * Embedding Service — OpenAI text-embedding-3-small (1536-dim).
 *
 * Cached in Redis with `REDIS_EMBEDDING_TTL_SECONDS` TTL (default 30d).
 *
 * The DGX BGE-M3 provider was retired 2026-05-27. The legacy
 * `SEARCH_EMBEDDING_PROVIDER` env is read for backward-compatible
 * logging only; the active provider is always OpenAI now.
 *
 * Pre-existing `embedding` (1024-dim) columns on `hts`, `knowledge_chunks`,
 * and `knowledge_cards` are dead data; a future migration drops them.
 * Reads/writes for any code using `providerInfo.column` route to
 * `embedding_openai`.
 */
@Injectable()
export class EmbeddingService implements IEmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  private readonly providerConfig: EmbeddingProviderConfig = {
    provider: 'openai',
    dimension: 1536,
    column: 'embedding_openai',
    property: 'embeddingOpenai',
  };
  private readonly openAiModel = 'text-embedding-3-small';

  private readonly redis: Redis;
  private readonly redisTtlSec: number;

  constructor(
    private readonly openAiService: OpenAiService,
    private readonly config: ConfigService,
  ) {
    // Log-only back-compat: surface if an operator still has the legacy
    // env set so they know it's now ignored.
    const legacyEnv = config.get<string>('SEARCH_EMBEDDING_PROVIDER');
    if (legacyEnv && legacyEnv.toLowerCase() !== 'openai') {
      this.logger.warn(
        `SEARCH_EMBEDDING_PROVIDER="${legacyEnv}" is ignored. ` +
          `DGX was retired 2026-05-27; provider is now OpenAI only.`,
      );
    }

    this.redisTtlSec = config.get<number>(
      'REDIS_EMBEDDING_TTL_SECONDS',
      30 * 24 * 3600,
    );
    this.redis = new Redis(
      config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      {
        lazyConnect: true,
        enableReadyCheck: false,
        connectTimeout: 1000,
        maxRetriesPerRequest: 0,
        retryStrategy: (times) => (times < 3 ? Math.min(times * 200, 1000) : null),
      },
    );

    this.logger.log(
      `Embedding provider: OPENAI (${this.providerConfig.dimension}-dim, ` +
        `model="${this.openAiModel}", ` +
        `column="${this.providerConfig.column}", ` +
        `property="${this.providerConfig.property}")`,
    );
  }

  /** Active provider configuration. Always OpenAI 1536-dim. */
  get providerInfo(): EmbeddingProviderConfig {
    return this.providerConfig;
  }

  /** Generate embedding for a single text. */
  async generateEmbedding(text: string): Promise<number[]> {
    return this.openAiEmbedding(text);
  }

  /** Generate embeddings for a batch of texts. */
  async generateBatch(texts: string[]): Promise<number[][]> {
    return this.openAiBatchEmbedding(texts);
  }

  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error(
        `Embedding dimension mismatch: ${embedding1.length} vs ${embedding2.length}`,
      );
    }
    let dot = 0,
      mag1 = 0,
      mag2 = 0;
    for (let i = 0; i < embedding1.length; i++) {
      dot += embedding1[i] * embedding2[i];
      mag1 += embedding1[i] ** 2;
      mag2 += embedding2[i] ** 2;
    }
    const denom = Math.sqrt(mag1) * Math.sqrt(mag2);
    return denom === 0 ? 0 : dot / denom;
  }

  getDimension(): number {
    return this.providerConfig.dimension;
  }

  // ── OpenAI path with Redis cache ────────────────────────────────────────────

  private async openAiEmbedding(text: string): Promise<number[]> {
    const key = this.openAiCacheKey(text);
    try {
      const cached = await this.redis.get(key);
      if (cached) {
        this.logger.debug('OpenAI embedding Redis cache hit');
        return JSON.parse(cached) as number[];
      }
    } catch {
      // Redis unavailable — proceed without cache
    }
    const embedding = await this.openAiService.generateEmbedding(text, this.openAiModel);
    this.redis
      .setex(key, this.redisTtlSec, JSON.stringify(embedding))
      .catch(() => {
        /* non-fatal */
      });
    return embedding;
  }

  private async openAiBatchEmbedding(texts: string[]): Promise<number[][]> {
    const keys = texts.map((t) => this.openAiCacheKey(t));
    const results: (number[] | null)[] = new Array(texts.length).fill(null);

    try {
      const cached = await this.redis.mget(...keys);
      cached.forEach((val, i) => {
        if (val) results[i] = JSON.parse(val) as number[];
      });
    } catch {
      // Redis unavailable
    }

    const missingIdx = results.reduce<number[]>(
      (acc, v, i) => (v === null ? [...acc, i] : acc),
      [],
    );

    if (missingIdx.length > 0) {
      const missingTexts = missingIdx.map((i) => texts[i]);
      this.logger.log(
        `OpenAI batch embed: ${missingTexts.length} new / ${texts.length - missingTexts.length} cached`,
      );
      const newEmbeddings = await this.openAiService.generateEmbeddingBatch(
        missingTexts,
        this.openAiModel,
      );
      const pipeline = this.redis.pipeline();
      newEmbeddings.forEach((vec, idx) => {
        const origIdx = missingIdx[idx];
        results[origIdx] = vec;
        pipeline.setex(keys[origIdx], this.redisTtlSec, JSON.stringify(vec));
      });
      await pipeline.exec().catch(() => {
        /* non-fatal */
      });
    }

    return results as number[][];
  }

  private openAiCacheKey(text: string): string {
    const hash = createHash('sha256')
      .update(text.trim().toLowerCase())
      .digest('hex')
      .slice(0, 40);
    return `hts:emb:oai:${hash}`;
  }

  /** @deprecated No-op — cache is in Redis. */
  clearCache(): void {
    this.logger.log('clearCache() is a no-op; embeddings are cached in Redis');
  }

  /** @deprecated Returns zeros — cache is in Redis. */
  getCacheStats(): { size: number; hitRate: number } {
    return { size: 0, hitRate: 0 };
  }
}
