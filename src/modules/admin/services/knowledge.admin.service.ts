/**
 * Knowledge Admin Service
 * Business logic for knowledge document management
 */

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsDocumentEntity, KnowledgeChunkEntity } from '@hts/knowledgebase';
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
    private queueService: QueueService,
  ) {}

  /**
   * Upload document (text, URL, or PDF file)
   */
  async uploadDocument(
    dto: UploadDocumentDto,
    file?: Express.Multer.File,
  ): Promise<HtsDocumentEntity> {
    let pdfData: Buffer | null = null;
    let textContent: string | null = null;
    let sourceUrl = dto.url || 'UPLOADED';
    let fileHash: string | null = null;

    // Handle different document types
    if (dto.type === 'PDF') {
      if (file) {
        // PDF file upload
        pdfData = file.buffer;
        fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
        sourceUrl = dto.url || `uploaded:${file.originalname}`;
      } else if (dto.url) {
        // PDF URL (will download in job handler)
        sourceUrl = dto.url;
      } else {
        throw new BadRequestException('PDF type requires either file upload or URL');
      }
    } else if (dto.type === 'URL') {
      if (!dto.url) {
        throw new BadRequestException('URL type requires url parameter');
      }
      sourceUrl = dto.url;
    } else if (dto.type === 'TEXT') {
      if (!dto.textContent) {
        throw new BadRequestException('TEXT type requires textContent parameter');
      }
      textContent = dto.textContent;
    }

    // Create document record
    const document = this.documentRepo.create({
      year: dto.year,
      chapter: dto.chapter,
      documentType: dto.type,
      sourceVersion: `${dto.year}_${dto.chapter}`,
      sourceUrl,
      pdfData,
      parsedText: textContent,
      status: dto.type === 'TEXT' ? 'PENDING' : 'PENDING',
      fileHash,
      fileSize: pdfData ? pdfData.length : null,
      isParsed: dto.type === 'TEXT',
      metadata: {
        title: dto.title,
        category: dto.category || 'general',
        uploadedAt: new Date().toISOString(),
      },
    });

    const saved = await this.documentRepo.save(document);
    this.logger.log(`Document uploaded: ${saved.id} (${dto.type})`);

    // Trigger processing job
    await this.queueService.sendJob('document-processing', { documentId: saved.id });

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
    const { status, year, chapter, type, page, pageSize } = dto;

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

    // Trigger processing job
    await this.queueService.sendJob('document-processing', { documentId: id });
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

    // Trigger batch reindex job
    const jobId = await this.queueService.sendJob('batch-reindex', {
      documentIds: documents.map((d) => d.id),
    });

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
