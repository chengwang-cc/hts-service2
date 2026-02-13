/**
 * Embedding Generation Job Handler
 * Generates embeddings for document chunks using OpenAI
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeChunkEntity } from '@hts/knowledgebase';
import { OpenAiService } from '@hts/core';

@Injectable()
export class EmbeddingGenerationJobHandler {
  private readonly logger = new Logger(EmbeddingGenerationJobHandler.name);

  constructor(
    @InjectRepository(KnowledgeChunkEntity)
    private chunkRepo: Repository<KnowledgeChunkEntity>,
    private openAiService: OpenAiService,
  ) {}

  /**
   * Execute embedding generation job
   */
  async execute(job: { data: { documentId: string } }): Promise<void> {
    const { documentId } = job.data;

    this.logger.log(`Generating embeddings for document: ${documentId}`);

    try {
      // Get all pending chunks for this document
      const chunks = await this.chunkRepo.find({
        where: { documentId, embeddingStatus: 'PENDING' },
        order: { chunkIndex: 'ASC' },
        take: 100, // Process in batches of 100
      });

      if (chunks.length === 0) {
        this.logger.log(`No pending chunks found for document ${documentId}`);
        return;
      }

      this.logger.log(`Processing ${chunks.length} chunks`);

      let generated = 0;
      let failed = 0;

      // Process chunks one by one (OpenAI has rate limits)
      for (const chunk of chunks) {
        try {
          // Generate embedding using OpenAI
          const embedding = await this.generateEmbedding(chunk.content);

          // Save embedding
          await this.chunkRepo.update(chunk.id, {
            embedding,
            embeddingStatus: 'GENERATED',
            embeddingGeneratedAt: new Date(),
          });

          generated++;

          if (generated % 10 === 0) {
            this.logger.log(`Progress: ${generated}/${chunks.length} embeddings generated`);
          }

          // Rate limiting: Wait 100ms between requests
          await this.sleep(100);
        } catch (error) {
          this.logger.error(
            `Failed to generate embedding for chunk ${chunk.id}: ${error.message}`,
          );

          await this.chunkRepo.update(chunk.id, {
            embeddingStatus: 'FAILED',
            errorMessage: error.message,
          });

          failed++;
        }
      }

      this.logger.log(
        `Embedding generation completed for document ${documentId}. Generated: ${generated}, Failed: ${failed}`,
      );

      // If there are more pending chunks, trigger another job
      const remainingCount = await this.chunkRepo.count({
        where: { documentId, embeddingStatus: 'PENDING' },
      });

      if (remainingCount > 0) {
        this.logger.log(`${remainingCount} chunks remaining, triggering next batch`);
        // Note: Would need to inject QueueService to trigger next batch
      }
    } catch (error) {
      this.logger.error(`Embedding generation failed for document ${documentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate embedding for text using OpenAI
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Use OpenAI embedding API
      const response = await this.openAiService.embedding({
        model: 'text-embedding-ada-002',
        input: text,
      });

      if (!response || !response.data || !response.data[0]?.embedding) {
        throw new Error('Invalid embedding response from OpenAI');
      }

      return response.data[0].embedding;
    } catch (error) {
      this.logger.error(`OpenAI embedding generation failed: ${error.message}`);
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
