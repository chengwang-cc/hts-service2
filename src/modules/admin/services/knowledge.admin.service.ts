/**
 * Knowledge Admin Service
 * Business logic for knowledge document management
 */

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsDocumentEntity, KnowledgeChunkEntity } from '@hts/knowledgebase';
import { UsitcDownloaderService } from '@hts/core';
import { QueueService } from '../../queue/queue.service';
import { UploadDocumentDto, ListDocumentsDto } from '../dto/knowledge.dto';
import * as crypto from 'crypto';

@Injectable()
export class KnowledgeAdminService {
  private readonly logger = new Logger(KnowledgeAdminService.name);

  constructor(
    @InjectRepository(HtsDocumentEntity)
    private documentRepo: Repository<HtsDocumentEntity>,
    @InjectRepository(KnowledgeChunkEntity)
    private chunkRepo: Repository<KnowledgeChunkEntity>,
    private usitcDownloader: UsitcDownloaderService,
    private queueService: QueueService,
  ) {}

  /**
   * Upload document (text, URL, or PDF file)
   * Supports simplified API: version="latest" OR year+revision
   */
  async uploadDocument(
    dto: UploadDocumentDto,
    file?: Express.Multer.File,
  ): Promise<HtsDocumentEntity> {
    let year: number;
    let chapter: string;
    let sourceUrl: string;
    let documentType: string = 'PDF';
    let pdfData: Buffer | null = null;
    let textContent: string | null = null;
    let fileHash: string | null = null;

    // Handle simplified API
    if (dto.version === 'latest' || (!dto.year && !dto.documentType)) {
      // Auto-detect latest revision
      this.logger.log('Auto-detecting latest HTS PDF...');
      const latest = await this.usitcDownloader.findLatestRevision();

      if (!latest) {
        throw new BadRequestException('Could not find any available HTS data');
      }

      year = latest.year;
      chapter = dto.chapter || '00';
      sourceUrl = latest.pdfUrl;
      this.logger.log(`Found latest: ${year} Rev ${latest.revision}`);
    } else if (dto.year && dto.revision) {
      // Specific year + revision
      year = dto.year;
      chapter = dto.chapter || '00';
      sourceUrl = this.usitcDownloader.getPdfDownloadUrl(dto.year, dto.revision);
    } else if (dto.documentType) {
      // Legacy support: explicit document type
      year = dto.year || new Date().getFullYear();
      chapter = dto.chapter || '00';
      documentType = dto.documentType;

      if (documentType === 'PDF') {
        if (file) {
          pdfData = file.buffer;
          fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
          sourceUrl = dto.sourceUrl || `uploaded:${file.originalname}`;
        } else if (dto.sourceUrl) {
          sourceUrl = dto.sourceUrl;
        } else {
          throw new BadRequestException('PDF type requires either file upload or URL');
        }
      } else if (documentType === 'URL') {
        sourceUrl = dto.sourceUrl || '';
        if (!sourceUrl) {
          throw new BadRequestException('URL type requires sourceUrl parameter');
        }
      } else if (documentType === 'TEXT') {
        sourceUrl = 'TEXT_CONTENT';
        textContent = dto.textContent || '';
        if (!textContent) {
          throw new BadRequestException('TEXT type requires textContent parameter');
        }
      } else {
        sourceUrl = '';
      }
    } else {
      throw new BadRequestException(
        'Must specify either: version="latest", year+revision, or legacy documentType fields'
      );
    }

    // Create document record
    const document = this.documentRepo.create({
      year,
      chapter,
      documentType,
      sourceVersion: `${year}_${chapter}`,
      sourceUrl,
      pdfData,
      parsedText: textContent,
      status: 'PENDING',
      fileHash,
      fileSize: pdfData ? pdfData.length : null,
      isParsed: documentType === 'TEXT',
      metadata: {
        title: dto.title || `HTS ${year} Chapter ${chapter}`,
        category: 'hts-official',
        uploadedAt: new Date().toISOString(),
      },
    });

    const saved = await this.documentRepo.save(document);
    this.logger.log(`Document uploaded: ${saved.id} (${documentType})`);

    // Trigger processing job with singleton key for cluster safety
    const jobId = await this.queueService.sendJob(
      'document-processing',
      { documentId: saved.id },
      {
        singletonKey: `document-processing-${saved.id}`,
        retryLimit: 3,
        expireInSeconds: 7200,
      },
    );

    this.logger.log(`Triggered document processing job ${jobId} for document ${saved.id}`);

    saved.jobId = jobId;
    await this.documentRepo.save(saved);

    return saved;
  }

  /**
   * Find all documents with filters
   */
  async findAll(dto: ListDocumentsDto): Promise<{
    data: HtsDocumentEntity[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { status, year, chapter, type } = dto;
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const query = this.documentRepo.createQueryBuilder('doc');

    if (status) {
      query.andWhere('doc.status = :status', { status });
    }

    if (year) {
      query.andWhere('doc.year = :year', { year });
    }

    if (chapter) {
      query.andWhere('doc.chapter = :chapter', { chapter });
    }

    if (type) {
      query.andWhere('doc.documentType = :type', { type });
    }

    query.orderBy('doc.createdAt', 'DESC');

    const [data, total] = await query
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { data, total, page, pageSize };
  }

  /**
   * Get document by ID
   */
  async findOne(id: string): Promise<HtsDocumentEntity> {
    const document = await this.documentRepo.findOne({ where: { id } });

    if (!document) {
      throw new NotFoundException(`Document not found: ${id}`);
    }

    return document;
  }

  /**
   * Re-index document (regenerate chunks and embeddings)
   */
  async reindexDocument(id: string): Promise<void> {
    const document = await this.findOne(id);

    this.logger.log(`Re-indexing document ${id}`);

    // Delete existing chunks
    await this.chunkRepo.delete({ documentId: id });

    // Update document status
    await this.documentRepo.update(id, { status: 'PENDING', processedAt: null });

    // Trigger processing job with singleton key for cluster safety
    const jobId = await this.queueService.sendJob(
      'document-processing',
      { documentId: id },
      {
        singletonKey: `document-processing-${id}`, // ✅ CRITICAL for cluster safety!
        retryLimit: 3,
        expireInSeconds: 7200, // 2 hours timeout
      },
    );

    this.logger.log(`Triggered document reprocessing job ${jobId} for document ${id}`);

    // Store job ID
    await this.documentRepo.update(id, { jobId });
  }

  /**
   * Re-index all documents
   */
  async reindexAll(): Promise<{ jobId: string; count: number }> {
    const documents = await this.documentRepo.find({ select: ['id'] });

    this.logger.log(`Re-indexing ${documents.length} documents`);

    // Delete all chunks
    await this.chunkRepo.delete({});

    // Reset all document statuses
    await this.documentRepo.update({}, { status: 'PENDING', processedAt: null });

    // Trigger batch reindex job with singleton key (only one batch reindex at a time)
    const jobId = await this.queueService.sendJob(
      'batch-reindex',
      {
        documentIds: documents.map((d) => d.id),
      },
      {
        singletonKey: 'batch-reindex-all', // ✅ Only one batch reindex at a time
        retryLimit: 1,
        expireInSeconds: 14400, // 4 hours timeout for batch operations
      },
    );

    this.logger.log(`Triggered batch reindex job ${jobId} for ${documents.length} documents`);

    return { jobId: jobId || '', count: documents.length };
  }

  /**
   * Delete document and its chunks
   */
  async remove(id: string): Promise<void> {
    const document = await this.findOne(id);

    // Delete chunks (cascade should handle this, but explicit is better)
    await this.chunkRepo.delete({ documentId: id });

    // Delete document
    await this.documentRepo.remove(document);

    this.logger.log(`Document ${id} deleted`);
  }

  /**
   * Get knowledge statistics
   */
  async getStats(): Promise<{
    totalDocuments: number;
    indexed: number;
    processing: number;
    totalChunks: number;
    totalEmbeddings: number;
  }> {
    const [totalDocuments, indexed, processing, totalChunks, totalEmbeddings] = await Promise.all([
      this.documentRepo.count(),
      this.documentRepo.count({ where: { status: 'COMPLETED' } }),
      this.documentRepo.count({ where: { status: 'PROCESSING' } }),
      this.chunkRepo.count(),
      this.chunkRepo.count({ where: { embeddingStatus: 'GENERATED' } }),
    ]);

    return {
      totalDocuments,
      indexed,
      processing,
      totalChunks,
      totalEmbeddings,
    };
  }
}
