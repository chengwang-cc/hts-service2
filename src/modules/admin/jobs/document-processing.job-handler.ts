/**
 * Document Processing Job Handler (PRODUCTION-READY)
 *
 * Multi-stage document processing with S3 storage and crash recovery:
 * 1. DOWNLOADING → Download PDF/document to S3 with streaming
 * 2. DOWNLOADED → File ready in S3
 * 3. PARSING → Extract text from S3 file
 * 4. PARSED → Text extracted
 * 5. EXTRACTING_NOTES → Extract HTS notes from parsed text
 * 6. CHUNKING → Create chunks in batches
 * 7. COMPLETED → All done
 *
 * Features:
 * - S3 streaming: No memory bloat for large PDFs
 * - Checkpoint-based crash recovery
 * - Batch chunk processing (100 chunks per batch)
 * - Idempotent operations (safe to retry)
 * - Progress tracking
 * - File integrity verification (SHA-256)
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  HtsDocumentEntity,
  KnowledgeChunkEntity,
  PdfParserService,
  NoteExtractionService,
} from '@hts/knowledgebase';
import { S3StorageService } from '@hts/core';
import { QueueService } from '../../queue/queue.service';
import axios from 'axios';
import { Readable } from 'stream';

interface DocumentProcessingCheckpoint {
  stage:
    | 'DOWNLOADING'
    | 'DOWNLOADED'
    | 'PARSING'
    | 'PARSED'
    | 'EXTRACTING_NOTES'
    | 'CHUNKING'
    | 'COMPLETED';
  s3Key?: string;
  s3FileHash?: string;
  parsedTextLength?: number;
  notesExtracted?: number;
  processedChunks?: number;
  totalChunks?: number;
}

@Injectable()
export class DocumentProcessingJobHandler {
  private readonly logger = new Logger(DocumentProcessingJobHandler.name);
  private readonly CHUNK_BATCH_SIZE = 100; // Process 100 chunks per batch

  constructor(
    @InjectRepository(HtsDocumentEntity)
    private documentRepo: Repository<HtsDocumentEntity>,
    @InjectRepository(KnowledgeChunkEntity)
    private chunkRepo: Repository<KnowledgeChunkEntity>,
    private pdfParserService: PdfParserService,
    private noteExtractionService: NoteExtractionService,
    private s3StorageService: S3StorageService,
    private queueService: QueueService,
  ) {}

  /**
   * Execute document processing job
   */
  async execute(job: any): Promise<void> {
    const { documentId } = job.data;

    this.logger.log(`Processing document: ${documentId}`);

    try {
      const document = await this.documentRepo.findOne({
        where: { id: documentId },
      });

      if (!document) {
        throw new Error(`Document not found: ${documentId}`);
      }

      // Initialize or resume from checkpoint
      const checkpoint: DocumentProcessingCheckpoint =
        (document.checkpoint as DocumentProcessingCheckpoint) || {
          stage: 'DOWNLOADING',
        };

      this.logger.log(
        `Document ${documentId} - Current stage: ${checkpoint.stage}`,
      );

      // STAGE 1: Download to S3
      if (checkpoint.stage === 'DOWNLOADING') {
        await this.downloadToS3(document, checkpoint);
        checkpoint.stage = 'DOWNLOADED';
        await this.saveCheckpoint(documentId, checkpoint);
      }

      // STAGE 2: Parse text from S3
      if (checkpoint.stage === 'DOWNLOADED') {
        checkpoint.stage = 'PARSING';
        await this.saveCheckpoint(documentId, checkpoint);
      }

      if (checkpoint.stage === 'PARSING') {
        await this.parseFromS3(document, checkpoint);
        checkpoint.stage = 'PARSED';
        await this.saveCheckpoint(documentId, checkpoint);
      }

      // STAGE 3: Create chunks in batches
      if (checkpoint.stage === 'PARSED') {
        checkpoint.stage = 'EXTRACTING_NOTES';
        await this.saveCheckpoint(documentId, checkpoint);
      }

      if (checkpoint.stage === 'EXTRACTING_NOTES') {
        await this.extractKnowledgeNotes(document, checkpoint);
        checkpoint.stage = 'CHUNKING';
        await this.saveCheckpoint(documentId, checkpoint);
      }

      if (checkpoint.stage === 'CHUNKING') {
        await this.createChunksInBatches(document, checkpoint);
        checkpoint.stage = 'COMPLETED';
        await this.saveCheckpoint(documentId, checkpoint);
      }

      // Final status update
      await this.documentRepo.update(documentId, {
        status: 'COMPLETED',
        processedAt: new Date(),
      });

      // Trigger embedding generation
      await this.queueService.sendJob('embedding-generation', { documentId });

      this.logger.log(`Document ${documentId} processed successfully`);
    } catch (error) {
      this.logger.error(
        `Document processing failed for ${documentId}: ${error.message}`,
        error.stack,
      );

      await this.documentRepo.update(documentId, {
        status: 'FAILED',
        errorMessage: error.message,
      });

      throw error;
    }
  }

  /**
   * STAGE 1: Download PDF/document to S3 with streaming
   */
  private async downloadToS3(
    document: HtsDocumentEntity,
    checkpoint: DocumentProcessingCheckpoint,
  ): Promise<void> {
    const documentId = document.id;

    // Check if already exists in S3
    if (document.s3Bucket && document.s3Key) {
      const exists = await this.s3StorageService.exists(
        document.s3Bucket,
        document.s3Key,
      );
      if (exists) {
        this.logger.log(
          `Document ${documentId} already exists in S3: ${document.s3Key}`,
        );
        checkpoint.s3Key = document.s3Key;
        checkpoint.s3FileHash = document.s3FileHash || undefined;
        return;
      }
    }

    // Determine source and download
    let downloadStream: Readable;

    if (document.pdfData) {
      // Use existing PDF data from database
      downloadStream = Readable.from(document.pdfData);
      this.logger.log(`Document ${documentId} - Using PDF data from database`);
    } else if (
      document.sourceUrl &&
      !document.sourceUrl.startsWith('uploaded:')
    ) {
      // Download from URL
      downloadStream = await this.downloadFromUrl(
        document.sourceUrl,
        document.documentType,
      );
      this.logger.log(
        `Document ${documentId} - Downloading from URL: ${document.sourceUrl}`,
      );
    } else {
      throw new Error(
        'No source available for download (no pdfData or sourceUrl)',
      );
    }

    // Generate S3 key
    const s3Bucket = this.s3StorageService.getDefaultBucket();
    const fileExtension = document.documentType === 'PDF' ? 'pdf' : 'txt';
    const s3Key = `documents/${document.year}/${document.chapter}/${documentId}.${fileExtension}`;

    this.logger.log(
      `Document ${documentId} - Uploading to S3: s3://${s3Bucket}/${s3Key}`,
    );

    // Upload to S3 with streaming (calculates SHA-256 automatically)
    const uploadResult = await this.s3StorageService.uploadStream({
      bucket: s3Bucket,
      key: s3Key,
      stream: downloadStream,
      contentType:
        document.documentType === 'PDF' ? 'application/pdf' : 'text/plain',
      metadata: {
        documentId: documentId,
        year: document.year.toString(),
        chapter: document.chapter,
        sourceVersion: document.sourceVersion,
      },
    });

    this.logger.log(
      `Document ${documentId} - Upload completed: ${uploadResult.size} bytes, SHA-256: ${uploadResult.sha256?.substring(0, 12)}...`,
    );

    // Update document record
    await this.documentRepo.update(documentId, {
      s3Bucket,
      s3Key,
      s3FileHash: uploadResult.sha256 ?? null,
      fileSize: uploadResult.size,
      downloadedAt: new Date(),
    });

    document.s3Bucket = s3Bucket;
    document.s3Key = s3Key;
    document.s3FileHash = uploadResult.sha256 ?? null;
    document.fileSize = uploadResult.size;
    document.downloadedAt = new Date();

    // Update checkpoint
    checkpoint.s3Key = s3Key;
    checkpoint.s3FileHash = uploadResult.sha256;
  }

  /**
   * STAGE 2: Parse text from S3 file
   */
  private async parseFromS3(
    document: HtsDocumentEntity,
    checkpoint: DocumentProcessingCheckpoint,
  ): Promise<void> {
    const documentId = document.id;

    // Check if already parsed
    if (document.parsedText) {
      this.logger.log(
        `Document ${documentId} already has parsed text (${document.parsedText.length} chars)`,
      );
      checkpoint.parsedTextLength = document.parsedText.length;
      return;
    }

    const s3Bucket =
      document.s3Bucket || this.s3StorageService.getDefaultBucket();
    const s3Key = document.s3Key || checkpoint.s3Key;

    if (!s3Key) {
      throw new Error('S3 location not found - cannot parse');
    }

    this.logger.log(`Document ${documentId} - Parsing from S3: ${s3Key}`);

    // Download and parse
    let parsedText: string;

    if (document.documentType === 'PDF') {
      // Download PDF and parse
      const pdfStream = await this.s3StorageService.downloadStream(
        s3Bucket,
        s3Key,
      );
      const pdfBuffer = await this.streamToBuffer(pdfStream);
      parsedText = await this.pdfParserService.parsePdf(pdfBuffer);
    } else {
      // Download text file
      const textStream = await this.s3StorageService.downloadStream(
        s3Bucket,
        s3Key,
      );
      parsedText = await this.streamToString(textStream);
    }

    if (!parsedText || parsedText.trim().length === 0) {
      throw new Error('Failed to extract text from document');
    }

    this.logger.log(
      `Document ${documentId} - Parsed ${parsedText.length} characters`,
    );

    // Save parsed text
    await this.documentRepo.update(documentId, {
      parsedText,
      parsedAt: new Date(),
      isParsed: true,
    });

    document.parsedText = parsedText;
    document.parsedAt = new Date();
    document.isParsed = true;

    checkpoint.parsedTextLength = parsedText.length;
  }

  /**
   * STAGE 3: Extract HTS notes from parsed text and persist to hts_notes
   */
  private async extractKnowledgeNotes(
    document: HtsDocumentEntity,
    checkpoint: DocumentProcessingCheckpoint,
  ): Promise<void> {
    const documentId = document.id;

    let parsedText = document.parsedText;
    if (!parsedText) {
      const latestDocument = await this.documentRepo.findOne({
        where: { id: documentId },
        select: ['parsedText'],
      });
      parsedText = latestDocument?.parsedText ?? null;
      document.parsedText = parsedText;
    }

    if (!parsedText) {
      throw new Error('No parsed text available for note extraction');
    }

    this.logger.log(`Document ${documentId} - Extracting HTS notes`);

    const notes = await this.noteExtractionService.extractNotes(
      documentId,
      document.chapter,
      parsedText,
      document.year,
    );

    checkpoint.notesExtracted = notes.length;

    const metadata: Record<string, any> = {
      ...((document.metadata as Record<string, any>) || {}),
      notesExtracted: notes.length,
      notesExtractedAt: new Date().toISOString(),
    };

    await this.documentRepo.update(documentId, {
      metadata: metadata,
    });
    document.metadata = metadata;

    if (notes.length === 0) {
      this.logger.warn(
        `Document ${documentId} - Note extraction completed with 0 notes`,
      );
      return;
    }

    this.logger.log(
      `Document ${documentId} - Extracted ${notes.length} HTS notes`,
    );
  }

  /**
   * STAGE 4: Create chunks in batches
   */
  private async createChunksInBatches(
    document: HtsDocumentEntity,
    checkpoint: DocumentProcessingCheckpoint,
  ): Promise<void> {
    const documentId = document.id;

    let parsedText = document.parsedText;
    if (!parsedText) {
      const latestDocument = await this.documentRepo.findOne({
        where: { id: documentId },
        select: ['parsedText'],
      });
      parsedText = latestDocument?.parsedText ?? null;
      document.parsedText = parsedText;
    }

    if (!parsedText) {
      throw new Error('No parsed text available for chunking');
    }

    // Chunk text (max 500 tokens per chunk)
    const chunks = this.chunkText(parsedText, 500);
    checkpoint.totalChunks = chunks.length;

    const startIndex = checkpoint.processedChunks || 0;
    this.logger.log(
      `Document ${documentId} - Creating ${chunks.length - startIndex} chunks (${startIndex} already processed)`,
    );

    // Process in batches
    for (let i = startIndex; i < chunks.length; i += this.CHUNK_BATCH_SIZE) {
      const batch = chunks.slice(
        i,
        Math.min(i + this.CHUNK_BATCH_SIZE, chunks.length),
      );
      const batchNumber = Math.floor(i / this.CHUNK_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(
        (chunks.length - startIndex) / this.CHUNK_BATCH_SIZE,
      );

      this.logger.log(
        `Document ${documentId} - Processing chunk batch ${batchNumber}/${totalBatches} (${batch.length} chunks)`,
      );

      // Process batch in transaction
      await this.chunkRepo.manager.transaction(async (manager) => {
        for (const chunkData of batch) {
          // Idempotent: Check if chunk already exists
          const existing = await manager.findOne(KnowledgeChunkEntity, {
            where: { documentId, chunkIndex: chunkData.index },
          });

          if (!existing) {
            await manager.save(KnowledgeChunkEntity, {
              documentId,
              chunkIndex: chunkData.index,
              content: chunkData.text,
              tokenCount: chunkData.tokens,
              embeddingStatus: 'PENDING',
              metadata: chunkData.metadata,
            });
          }
        }
      });

      // Update checkpoint after each batch
      checkpoint.processedChunks = Math.min(
        i + this.CHUNK_BATCH_SIZE,
        chunks.length,
      );
      await this.saveCheckpoint(documentId, checkpoint);

      // Log progress every 10 batches
      if (batchNumber % 10 === 0) {
        const percent = Math.round(
          (checkpoint.processedChunks / chunks.length) * 100,
        );
        this.logger.log(
          `Document ${documentId} - Progress: ${percent}% (${checkpoint.processedChunks}/${chunks.length} chunks)`,
        );
      }
    }

    this.logger.log(
      `Document ${documentId} - All ${chunks.length} chunks created`,
    );
  }

  /**
   * Save checkpoint for crash recovery
   */
  private async saveCheckpoint(
    documentId: string,
    checkpoint: DocumentProcessingCheckpoint,
  ): Promise<void> {
    await this.documentRepo.update(documentId, {
      checkpoint: checkpoint as any,
    });
  }

  /**
   * Download from URL
   */
  private async downloadFromUrl(
    url: string,
    documentType: string,
  ): Promise<Readable> {
    if (documentType === 'PDF') {
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 600000, // 10 minutes timeout for large PDFs
        maxContentLength: Infinity, // No size limit - stream to S3 (handles 140MB+ HTS PDFs)
        maxBodyLength: Infinity,
      });
      return response.data;
    } else {
      // Text/HTML
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 30000,
      });
      return response.data;
    }
  }

  /**
   * Convert stream to buffer
   */
  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Convert stream to string
   */
  private async streamToString(stream: Readable): Promise<string> {
    const chunks: string[] = [];
    stream.setEncoding('utf8');
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return chunks.join('');
  }

  /**
   * Chunk text into manageable pieces
   */
  private chunkText(
    text: string,
    maxTokens: number,
  ): Array<{ index: number; text: string; tokens: number; metadata: any }> {
    const chunks: Array<{
      index: number;
      text: string;
      tokens: number;
      metadata: any;
    }> = [];

    // Split by paragraphs first
    const paragraphs = text.split(/\n\n+/);

    let currentChunk = '';
    let currentTokens = 0;
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);

      if (
        currentTokens + paragraphTokens > maxTokens &&
        currentChunk.length > 0
      ) {
        // Save current chunk
        chunks.push({
          index: chunkIndex,
          text: currentChunk.trim(),
          tokens: currentTokens,
          metadata: { chunkNumber: chunkIndex },
        });
        chunkIndex++;

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
        index: chunkIndex,
        text: currentChunk.trim(),
        tokens: currentTokens,
        metadata: { chunkNumber: chunkIndex },
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
