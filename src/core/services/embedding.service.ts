import { Injectable, Logger, Optional } from '@nestjs/common';
import { IEmbeddingService } from '../interfaces/embedding.interface';
import { OpenAiService } from './openai.service';
import { DgxEmbeddingService } from '../dgx/dgx-embedding.service';

/**
 * Embedding Service
 *
 * Routes embedding requests to the DGX Spark self-hosted model when
 * DGX_EMBEDDING_ENABLED=true, with automatic fallback to OpenAI on error.
 * Also replaces the volatile in-memory cache with Redis-backed caching
 * (handled inside DgxEmbeddingService).
 */
@Injectable()
export class EmbeddingService implements IEmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly openAiModel = 'text-embedding-3-small';
  private readonly dimension = 1024;
  private readonly fallbackCache: Map<string, number[]> = new Map();

  constructor(
    private readonly openAiService: OpenAiService,
    @Optional() private readonly dgxEmbedding: DgxEmbeddingService,
  ) {
    const dgxActive = dgxEmbedding?.isEnabled ?? false;
    this.logger.log(
      `Embedding service initialized — DGX: ${dgxActive ? 'enabled (primary)' : 'disabled (OpenAI only)'}`,
    );
  }

  /**
   * Generate embedding for single text.
   * Tries DGX (Redis-cached, self-hosted model) first, falls back to OpenAI.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (this.dgxEmbedding?.isEnabled) {
      // DGX (BGE-M3, 1024-dim) is the primary provider.
      // Do NOT fall back to OpenAI on failure: OpenAI text-embedding-3-small uses a
      // different vector space and dimension (1536) than the stored HTS embeddings,
      // so the pgvector <=> operator would throw a dimension-mismatch error anyway.
      // Let the error propagate so hybridSearch's try/catch skips semantic search.
      return this.dgxEmbedding.embed(text);
    }
    return this.openAiEmbedding(text);
  }

  /**
   * Generate embeddings for a batch of texts.
   * Tries DGX (Redis-cached, self-hosted model) first, falls back to OpenAI.
   */
  async generateBatch(texts: string[]): Promise<number[][]> {
    if (this.dgxEmbedding?.isEnabled) {
      // Same reasoning as generateEmbedding: let DGX failures propagate rather
      // than calling OpenAI with an incompatible embedding model/dimension.
      return this.dgxEmbedding.embedBatch(texts);
    }
    return this.openAiBatchEmbedding(texts);
  }

  /**
   * Calculate cosine similarity between two embeddings.
   * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite).
   */
  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have same dimensions');
    }
    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;
    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      magnitude1 += embedding1[i] * embedding1[i];
      magnitude2 += embedding2[i] * embedding2[i];
    }
    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);
    if (magnitude1 === 0 || magnitude2 === 0) return 0;
    return dotProduct / (magnitude1 * magnitude2);
  }

  getDimension(): number {
    return this.dimension;
  }

  clearCache(): void {
    this.fallbackCache.clear();
    this.logger.log('In-memory fallback cache cleared');
  }

  getCacheStats(): { size: number; hitRate: number } {
    return { size: this.fallbackCache.size, hitRate: 0 };
  }

  // ── OpenAI fallback path ─────────────────────────────────────────────────

  private async openAiEmbedding(text: string): Promise<number[]> {
    const key = this.fallbackCacheKey(text);
    if (this.fallbackCache.has(key)) {
      this.logger.debug('In-memory cache hit');
      return this.fallbackCache.get(key)!;
    }
    const embedding = await this.openAiService.generateEmbedding(text, this.openAiModel);
    this.setFallbackCache(key, embedding);
    return embedding;
  }

  private async openAiBatchEmbedding(texts: string[]): Promise<number[][]> {
    const uncachedTexts: string[] = [];
    const uncachedIndexes: number[] = [];
    const results: number[][] = new Array(texts.length);

    texts.forEach((text, index) => {
      const key = this.fallbackCacheKey(text);
      if (this.fallbackCache.has(key)) {
        results[index] = this.fallbackCache.get(key)!;
      } else {
        uncachedTexts.push(text);
        uncachedIndexes.push(index);
      }
    });

    if (uncachedTexts.length > 0) {
      this.logger.log(
        `OpenAI batch: ${uncachedTexts.length} new / ${texts.length - uncachedTexts.length} cached`,
      );
      const newEmbeddings = await this.openAiService.generateEmbeddingBatch(
        uncachedTexts,
        this.openAiModel,
      );
      uncachedTexts.forEach((text, i) => {
        const embedding = newEmbeddings[i];
        results[uncachedIndexes[i]] = embedding;
        this.setFallbackCache(this.fallbackCacheKey(text), embedding);
      });
    }
    return results;
  }

  private setFallbackCache(key: string, embedding: number[]): void {
    if (this.fallbackCache.size >= 10_000) {
      const firstKey = this.fallbackCache.keys().next().value;
      this.fallbackCache.delete(firstKey);
    }
    this.fallbackCache.set(key, embedding);
  }

  private fallbackCacheKey(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `${this.openAiModel}:${hash}`;
  }
}
