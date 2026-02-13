/**
 * Embedding Service Interface
 * Provides abstraction for generating and managing embeddings
 */
export interface IEmbeddingService {
  /**
   * Generate embedding for single text
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Generate embeddings for batch of texts
   */
  generateBatch(texts: string[]): Promise<number[][]>;

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(embedding1: number[], embedding2: number[]): number;

  /**
   * Get embedding dimension size
   */
  getDimension(): number;
}
