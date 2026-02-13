/**
 * Document Processing Job Handler
 * Processes documents: downloads PDFs, parses text, creates chunks
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsDocumentEntity, KnowledgeChunkEntity } from '@hts/knowledgebase';
import { QueueService } from '../../queue/queue.service';
import axios from 'axios';

@Injectable()
export class DocumentProcessingJobHandler {
  private readonly logger = new Logger(DocumentProcessingJobHandler.name);

  constructor(
    @InjectRepository(HtsDocumentEntity)
    private documentRepo: Repository<HtsDocumentEntity>,
    @InjectRepository(KnowledgeChunkEntity)
    private chunkRepo: Repository<KnowledgeChunkEntity>,
    private queueService: QueueService,
  ) {}

  /**
   * Execute document processing job
   */
  async execute(job: { data: { documentId: string } }): Promise<void> {
    const { documentId } = job.data;

    this.logger.log(`Processing document: ${documentId}`);

    try {
      const document = await this.documentRepo.findOne({ where: { id: documentId } });

      if (!document) {
        throw new Error(`Document not found: ${documentId}`);
      }

      // Update status to PROCESSING
      await this.documentRepo.update(documentId, { status: 'PROCESSING' });

      let text = document.parsedText;

      // If not parsed yet, parse based on type
      if (!text) {
        if (document.documentType === 'PDF') {
          if (document.pdfData) {
            // Parse PDF from buffer
            text = await this.parsePdfBuffer(document.pdfData);
          } else if (document.sourceUrl && !document.sourceUrl.startsWith('uploaded:')) {
            // Download and parse PDF from URL
            const pdfBuffer = await this.downloadPdf(document.sourceUrl);
            text = await this.parsePdfBuffer(pdfBuffer);

            // Save PDF data
            await this.documentRepo.update(documentId, {
              pdfData: pdfBuffer,
              fileSize: pdfBuffer.length,
              downloadedAt: new Date(),
            });
          }
        } else if (document.documentType === 'URL') {
          // Download and parse HTML/text from URL
          text = await this.downloadText(document.sourceUrl);
        }

        if (!text) {
          throw new Error('Failed to extract text from document');
        }

        // Save parsed text
        await this.documentRepo.update(documentId, {
          parsedText: text,
          parsedAt: new Date(),
          isParsed: true,
        });
      }

      // Chunk text (max 500 tokens per chunk)
      const chunks = this.chunkText(text, 500);

      this.logger.log(`Created ${chunks.length} chunks for document ${documentId}`);

      // Save chunks
      for (let i = 0; i < chunks.length; i++) {
        await this.chunkRepo.save({
          documentId,
          chunkIndex: i,
          content: chunks[i].text,
          tokenCount: chunks[i].tokens,
          embeddingStatus: 'PENDING',
          metadata: chunks[i].metadata,
        });
      }

      // Update document status
      await this.documentRepo.update(documentId, {
        status: 'COMPLETED',
        processedAt: new Date(),
      });

      // Trigger embedding generation
      await this.queueService.sendJob('embedding-generation', { documentId });

      this.logger.log(`Document ${documentId} processed successfully`);
    } catch (error) {
      this.logger.error(`Document processing failed for ${documentId}: ${error.message}`);

      await this.documentRepo.update(documentId, {
        status: 'FAILED',
        errorMessage: error.message,
      });
    }
  }

  /**
   * Download PDF from URL
   */
  private async downloadPdf(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024, // 50MB max
    });

    return Buffer.from(response.data);
  }

  /**
   * Download text from URL
   */
  private async downloadText(url: string): Promise<string> {
    const response = await axios.get(url, {
      timeout: 30000,
    });

    return response.data;
  }

  /**
   * Parse PDF buffer to text
   * Note: Requires pdf-parse package
   */
  private async parsePdfBuffer(buffer: Buffer): Promise<string> {
    try {
      // Try to use pdf-parse if available
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return data.text;
    } catch (error) {
      this.logger.warn('pdf-parse not available, using simple text extraction');
      // Fallback: Simple text extraction (very basic)
      return buffer.toString('utf-8').replace(/[^\x20-\x7E\n]/g, '');
    }
  }

  /**
   * Chunk text into manageable pieces
   * Simple chunking by tokens (approximate)
   */
  private chunkText(
    text: string,
    maxTokens: number,
  ): Array<{ text: string; tokens: number; metadata: any }> {
    const chunks: Array<{ text: string; tokens: number; metadata: any }> = [];

    // Split by paragraphs first
    const paragraphs = text.split(/\n\n+/);

    let currentChunk = '';
    let currentTokens = 0;
    let chunkCount = 0;

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);

      if (currentTokens + paragraphTokens > maxTokens && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          text: currentChunk.trim(),
          tokens: currentTokens,
          metadata: { chunkNumber: chunkCount++ },
        });

        // Start new chunk
        currentChunk = paragraph;
        currentTokens = paragraphTokens;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        currentTokens += paragraphTokens;
      }
    }

    // Save last chunk
    if (currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        tokens: currentTokens,
        metadata: { chunkNumber: chunkCount },
      });
    }

    return chunks;
  }

  /**
   * Estimate token count (rough approximation: 1 token ≈ 4 characters)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
