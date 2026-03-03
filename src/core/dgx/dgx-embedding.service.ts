import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { createHash } from 'crypto';
import Redis from 'ioredis';

interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dim: number;
  count: number;
  duration_ms: number;
}

interface HealthResponse {
  status: string;
  model_loaded: boolean;
  model: string;
  dim: number | null;
}

/**
 * DGX Embedding Service
 *
 * Replaces the volatile in-memory EmbeddingService cache with Redis-backed
 * caching and routes embedding requests to the self-hosted BGE-M3 model
 * running on the DGX Spark machine.
 *
 * Falls back to OpenAI when DGX is disabled or unreachable.
 */
@Injectable()
export class DgxEmbeddingService implements OnModuleDestroy {
  private readonly log = new Logger(DgxEmbeddingService.name);
  private readonly redis: Redis;
  private readonly enabled: boolean;
  private readonly embeddingTtlSec: number;
  private readonly embedPath: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.enabled = config.get<string>('DGX_EMBEDDING_ENABLED', 'true') === 'true';
    this.embeddingTtlSec = config.get<number>(
      'REDIS_EMBEDDING_TTL_SECONDS',
      30 * 24 * 3600, // 30 days
    );
    this.embedPath = config.get<string>('DGX_EMBED_PATH', '/embed');

    this.redis = new Redis(
      config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      { lazyConnect: true, enableReadyCheck: false },
    );

    this.redis.on('error', (err) => {
      this.log.warn(`Redis error: ${err.message}`);
    });

    if (this.enabled) {
      this.redis.connect().catch(() => {
        this.log.warn('Redis not reachable — embedding cache will be skipped');
      });
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get embedding for a single text with Redis caching.
   */
  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec;
  }

  /**
   * Get embeddings for multiple texts. Each result is cached independently.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.enabled) {
      throw new Error('DGX embedding service is disabled (DGX_EMBEDDING_ENABLED=false)');
    }

    const keys = texts.map((t) => this.cacheKey(t));
    const results: (number[] | null)[] = new Array(texts.length).fill(null);

    // Batch Redis GET
    try {
      const cached = await this.redis.mget(...keys);
      cached.forEach((val, i) => {
        if (val) results[i] = JSON.parse(val) as number[];
      });
    } catch {
      // Redis unavailable — continue without cache
    }

    const missingIdx = results.reduce<number[]>(
      (acc, v, i) => (v === null ? [...acc, i] : acc),
      [],
    );

    if (missingIdx.length > 0) {
      const missingTexts = missingIdx.map((i) => texts[i]);
      const t0 = Date.now();

      const { data } = await firstValueFrom(
        this.http.post<EmbedResponse>(this.embedPath, {
          texts: missingTexts,
          normalize: true,
        }),
      );

      this.log.log(
        `DGX embed: ${missingTexts.length} texts → ${data.model} (${data.dim}d) in ${Date.now() - t0}ms`,
      );

      // Write results + cache
      const pipeline = this.redis.pipeline();
      data.embeddings.forEach((vec, idx) => {
        const origIdx = missingIdx[idx];
        results[origIdx] = vec;
        pipeline.setex(keys[origIdx], this.embeddingTtlSec, JSON.stringify(vec));
      });
      await pipeline.exec().catch(() => {
        // Redis pipeline failure is non-fatal
      });
    }

    return results as number[][];
  }

  /**
   * Flush all embedding cache entries from Redis.
   * Call after re-embedding the corpus with a new model.
   */
  async flushEmbeddingCache(): Promise<number> {
    const keys = await this.redis.keys('hts:emb:*');
    if (keys.length === 0) return 0;
    return this.redis.del(...keys);
  }

  async checkHealth(): Promise<HealthResponse> {
    const { data } = await firstValueFrom(
      this.http.get<HealthResponse>('/health'),
    );
    return data;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private cacheKey(text: string): string {
    const hash = createHash('sha256')
      .update(text.trim().toLowerCase())
      .digest('hex')
      .slice(0, 40);
    return `hts:emb:${hash}`;
  }
}
