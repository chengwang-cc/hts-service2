import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { IEmbeddingService } from '../interfaces/embedding.interface';
import { OpenAiService } from './openai.service';
import { DgxEmbeddingService } from '../dgx/dgx-embedding.service';

export type EmbeddingProvider = 'dgx' | 'openai';

export interface EmbeddingProviderConfig {
  /** Active provider name */
  provider: EmbeddingProvider;
  /** Vector dimension for the active provider */
  dimension: number;
  /**
   * PostgreSQL column name (snake_case) for use in raw pgvector SQL expressions,
   * e.g. `addSelect('1 - (hts.embedding_openai <=> :v)', 'similarity')`.
   * TypeORM passes complex addSelect expressions through as raw SQL — it does
   * NOT resolve the alias.column reference through the NamingStrategy here.
   *
   * 'embedding'        = DGX column (vector(1024))
   * 'embedding_openai' = OpenAI column (vector(1536))
   */
  column: 'embedding' | 'embedding_openai';
  /**
   * TypeORM entity property name (camelCase) for use in QueryBuilder
   * where / andWhere / orderBy / select clauses.
   * TypeORM resolves these through the NamingStrategy — using the snake_case
   * column name instead causes:
   *   TypeError: Cannot read properties of undefined (reading 'databaseName')
   *
   * 'embedding'       = DGX entity property
   * 'embeddingOpenai' = OpenAI entity property
   */
  property: 'embedding' | 'embeddingOpenai';
}

/**
 * Embedding Service
 *
 * Routes embedding requests to one of two providers, selected by the
 * SEARCH_EMBEDDING_PROVIDER environment variable:
 *
 *   SEARCH_EMBEDDING_PROVIDER=dgx    → DGX Spark BGE-M3 (1024-dim, Redis-cached)
 *   SEARCH_EMBEDDING_PROVIDER=openai → OpenAI text-embedding-3-small (1536-dim, Redis-cached)
 *
 * Each provider has its own HtsEntity column so dimensions never collide:
 *   DGX    → hts.embedding          (vector(1024))
 *   OpenAI → hts.embedding_openai   (vector(1536))
 *
 * Both paths cache embeddings in Redis with REDIS_EMBEDDING_TTL_SECONDS TTL,
 * so query-time latency is minimal after the first occurrence of a text.
 */
@Injectable()
export class EmbeddingService implements IEmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  private readonly providerConfig: EmbeddingProviderConfig;
  private readonly openAiModel = 'text-embedding-3-small';

  /** Redis client for the OpenAI embedding cache */
  private readonly redis: Redis;
  private readonly redisTtlSec: number;

  constructor(
    private readonly openAiService: OpenAiService,
    private readonly config: ConfigService,
    @Optional() private readonly dgxEmbedding: DgxEmbeddingService,
  ) {
    const raw = config.get<string>('SEARCH_EMBEDDING_PROVIDER', 'dgx').toLowerCase();
    const provider: EmbeddingProvider = raw === 'openai' ? 'openai' : 'dgx';

    this.providerConfig = provider === 'dgx'
      ? { provider: 'dgx', dimension: 1024, column: 'embedding', property: 'embedding' }
      : { provider: 'openai', dimension: 1536, column: 'embedding_openai', property: 'embeddingOpenai' };

    this.redisTtlSec = config.get<number>('REDIS_EMBEDDING_TTL_SECONDS', 30 * 24 * 3600);
    this.redis = new Redis(
      config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      { lazyConnect: true, enableReadyCheck: false },
    );

    this.logger.log(
      `Embedding provider: ${provider.toUpperCase()} ` +
      `(${this.providerConfig.dimension}-dim, column: "${this.providerConfig.column}", property: "${this.providerConfig.property}")` +
      (provider === 'dgx' && !(dgxEmbedding?.isEnabled)
        ? ' — WARNING: DGX_EMBEDDING_ENABLED is false'
        : ''),
    );
  }

  /**
   * Returns the active provider configuration.
   * SearchService uses this to pick the correct pgvector column at query time.
   */
  get providerInfo(): EmbeddingProviderConfig {
    return this.providerConfig;
  }

  /** Generate embedding for a single text via the configured provider. */
  async generateEmbedding(text: string): Promise<number[]> {
    if (this.providerConfig.provider === 'dgx') {
      // DGX path: Redis-cached inside DgxEmbeddingService.
      // Errors propagate — dimension mismatch with OpenAI makes fallback impossible.
      return this.dgxEmbedding.embed(text);
    }
    return this.openAiEmbedding(text);
  }

  /** Generate embeddings for a batch of texts. */
  async generateBatch(texts: string[]): Promise<number[][]> {
    if (this.providerConfig.provider === 'dgx') {
      return this.dgxEmbedding.embedBatch(texts);
    }
    return this.openAiBatchEmbedding(texts);
  }

  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error(
        `Embedding dimension mismatch: ${embedding1.length} vs ${embedding2.length}`,
      );
    }
    let dot = 0, mag1 = 0, mag2 = 0;
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
    this.redis.setex(key, this.redisTtlSec, JSON.stringify(embedding)).catch(() => {/* non-fatal */});
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
      await pipeline.exec().catch(() => {/* non-fatal */});
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

  /** @deprecated No-op — cache is now in Redis, not in-memory */
  clearCache(): void {
    this.logger.log('clearCache() is a no-op; embeddings are cached in Redis');
  }

  /** @deprecated Returns zeros — cache is in Redis */
  getCacheStats(): { size: number; hitRate: number } {
    return { size: 0, hitRate: 0 };
  }
}
