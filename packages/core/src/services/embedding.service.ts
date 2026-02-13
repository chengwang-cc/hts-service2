import { Injectable, Logger } from '@nestjs/common';
import { IEmbeddingService } from '../interfaces/embedding.interface';
import { OpenAiService } from './openai.service';

/**
 * Embedding Service
 * Manages generation and caching of vector embeddings for semantic search
 */
@Injectable()
export class EmbeddingService implements IEmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly model = 'text-embedding-3-small';
  private readonly dimension = 1536;
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(private readonly openAiService: OpenAiService) {
    this.logger.log('Embedding service initialized');
  }

  /**
   * Generate embedding for single text with caching
   */
  async generateEmbedding(text: string): Promise<number[]> {
    // Check cache first
    const cacheKey = this.getCacheKey(text);
    if (this.embeddingCache.has(cacheKey)) {
      this.logger.debug('Embedding cache hit');
      return this.embeddingCache.get(cacheKey)!;
    }

    // Generate new embedding
    const embedding = await this.openAiService.generateEmbedding(
      text,
      this.model,
    );

    // Cache the result
    this.embeddingCache.set(cacheKey, embedding);

    // Limit cache size to prevent memory issues
    if (this.embeddingCache.size > 10000) {
      const firstKey = this.embeddingCache.keys().next().value;
      this.embeddingCache.delete(firstKey);
    }

    return embedding;
  }

  /**
   * Generate embeddings for batch of texts
   * More efficient than calling generateEmbedding multiple times
   */
  async generateBatch(texts: string[]): Promise<number[][]> {
    // Check which texts are already cached
    const uncachedTexts: string[] = [];
    const uncachedIndexes: number[] = [];
    const results: number[][] = new Array(texts.length);

    texts.forEach((text, index) => {
      const cacheKey = this.getCacheKey(text);
      if (this.embeddingCache.has(cacheKey)) {
        results[index] = this.embeddingCache.get(cacheKey)!;
      } else {
        uncachedTexts.push(text);
        uncachedIndexes.push(index);
      }
    });

    // Generate embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      this.logger.log(
        `Generating ${uncachedTexts.length} embeddings (${texts.length - uncachedTexts.length} cached)`,
      );

      const newEmbeddings = await this.openAiService.generateEmbeddingBatch(
        uncachedTexts,
        this.model,
      );

      // Store results and cache
      uncachedTexts.forEach((text, i) => {
        const embedding = newEmbeddings[i];
        const resultIndex = uncachedIndexes[i];
        results[resultIndex] = embedding;

        // Cache the new embedding
        const cacheKey = this.getCacheKey(text);
        this.embeddingCache.set(cacheKey, embedding);
      });
    } else {
      this.logger.debug(`All ${texts.length} embeddings from cache`);
    }

    return results;
  }

  /**
   * Calculate cosine similarity between two embeddings
   * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
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

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Get embedding dimension
   */
  getDimension(): number {
    return this.dimension;
  }

  /**
   * Generate cache key for text
   */
  private getCacheKey(text: string): string {
    // Simple hash function for cache key
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `${this.model}:${hash}`;
  }

  /**
   * Clear embedding cache
   */
  clearCache(): void {
    this.embeddingCache.clear();
    this.logger.log('Embedding cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.embeddingCache.size,
      hitRate: 0, // TODO: Track hit rate
    };
  }
}
