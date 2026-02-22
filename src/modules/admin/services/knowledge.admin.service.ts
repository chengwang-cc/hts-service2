/**
 * Knowledge Admin Service
 * Business logic for knowledge document management
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  HtsDocumentEntity,
  KnowledgeChunkEntity,
  DocumentService as KnowledgeDocumentService,
  NoteResolutionService,
} from '@hts/knowledgebase';
import { UsitcDownloaderService } from '@hts/core';
import { QueueService } from '../../queue/queue.service';
import {
  UploadDocumentDto,
  ListDocumentsDto,
  NoteBackfillOptionsDto,
} from '../dto/knowledge.dto';
import * as crypto from 'crypto';

type BackfillTargetAction = 'IMPORT' | 'SKIP_ALREADY_PRESENT';

interface BackfillTarget {
  year: number;
  chapter: string;
  unresolvedReferences: number;
}

interface BackfillPlanTarget extends BackfillTarget {
  existingNotes: number;
  action: BackfillTargetAction;
}

interface BackfillRunTarget extends BackfillPlanTarget {
  status: 'IMPORTED' | 'SKIPPED' | 'FAILED';
  notesExtracted?: number;
  notesInDb?: number;
  documentId?: string;
  error?: string;
}

interface HtsNoteCandidate {
  hts_number: string;
  version: string | null;
  general: string | null;
  other: string | null;
}

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
    private dataSource: DataSource,
    private knowledgeDocumentService: KnowledgeDocumentService,
    private noteResolutionService: NoteResolutionService,
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
      sourceUrl = this.usitcDownloader.getPdfDownloadUrl(
        dto.year,
        dto.revision,
      );
    } else if (dto.documentType) {
      // Legacy support: explicit document type
      year = dto.year || new Date().getFullYear();
      chapter = dto.chapter || '00';
      documentType = dto.documentType;

      if (documentType === 'PDF') {
        if (file) {
          pdfData = file.buffer;
          fileHash = crypto
            .createHash('sha256')
            .update(file.buffer)
            .digest('hex');
          sourceUrl = dto.sourceUrl || `uploaded:${file.originalname}`;
        } else if (dto.sourceUrl) {
          sourceUrl = dto.sourceUrl;
        } else {
          throw new BadRequestException(
            'PDF type requires either file upload or URL',
          );
        }
      } else if (documentType === 'URL') {
        sourceUrl = dto.sourceUrl || '';
        if (!sourceUrl) {
          throw new BadRequestException(
            'URL type requires sourceUrl parameter',
          );
        }
      } else if (documentType === 'TEXT') {
        sourceUrl = 'TEXT_CONTENT';
        textContent = dto.textContent || '';
        if (!textContent) {
          throw new BadRequestException(
            'TEXT type requires textContent parameter',
          );
        }
      } else {
        sourceUrl = '';
      }
    } else {
      throw new BadRequestException(
        'Must specify either: version="latest", year+revision, or legacy documentType fields',
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

    this.logger.log(
      `Triggered document processing job ${jobId} for document ${saved.id}`,
    );

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
    await this.documentRepo.update(id, {
      status: 'PENDING',
      processedAt: null,
    });

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

    this.logger.log(
      `Triggered document reprocessing job ${jobId} for document ${id}`,
    );

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
    await this.documentRepo.update(
      {},
      { status: 'PENDING', processedAt: null },
    );

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

    this.logger.log(
      `Triggered batch reindex job ${jobId} for ${documents.length} documents`,
    );

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
    const [totalDocuments, indexed, processing, totalChunks, totalEmbeddings] =
      await Promise.all([
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

  async previewNoteBackfill(dto: NoteBackfillOptionsDto): Promise<{
    options: {
      year: number;
      chapters?: string[];
      force: boolean;
      dedupe: boolean;
    };
    totals: {
      targets: number;
      unresolvedReferences: number;
      existingNotes: number;
      willImport: number;
      willSkip: number;
    };
    targets: BackfillPlanTarget[];
  }> {
    const options = await this.normalizeBackfillOptions(dto);
    const plan = await this.buildBackfillPlan(options);

    return {
      options,
      totals: plan.totals,
      targets: plan.targets,
    };
  }

  async applyNoteBackfill(dto: NoteBackfillOptionsDto): Promise<{
    options: {
      year: number;
      chapters?: string[];
      force: boolean;
      dedupe: boolean;
    };
    totals: {
      targets: number;
      unresolvedReferences: number;
      existingNotes: number;
      willImport: number;
      willSkip: number;
    };
    execution: {
      importedTargets: number;
      skippedTargets: number;
      failedTargets: number;
      dedupeDeletedRows: number;
    };
    referenceResolution: {
      total: number;
      resolved: number;
      unresolved: number;
    };
    targets: BackfillRunTarget[];
  }> {
    const options = await this.normalizeBackfillOptions(dto);
    const plan = await this.buildBackfillPlan(options);
    const runResults: BackfillRunTarget[] = [];

    for (const target of plan.targets) {
      if (target.action === 'SKIP_ALREADY_PRESENT') {
        runResults.push({
          ...target,
          status: 'SKIPPED',
          notesInDb: target.existingNotes,
        });
        continue;
      }

      try {
        this.logger.log(
          `[knowledge-note-backfill] importing year=${target.year} chapter=${target.chapter}`,
        );

        const document = await this.knowledgeDocumentService.downloadDocument(
          target.year,
          target.chapter,
        );
        const result = await this.knowledgeDocumentService.parseAndExtractNotes(
          document.id,
        );
        const notesInDb = await this.countNotesForTarget(
          target.year,
          target.chapter,
        );

        runResults.push({
          ...target,
          status: 'IMPORTED',
          documentId: document.id,
          notesExtracted: result.notesExtracted,
          notesInDb,
        });
      } catch (error: any) {
        const message = error?.message || 'Unknown error';
        this.logger.error(
          `[knowledge-note-backfill] failed year=${target.year} chapter=${target.chapter}: ${message}`,
          error?.stack,
        );

        runResults.push({
          ...target,
          status: 'FAILED',
          error: message,
        });
      }
    }

    const dedupeDeletedRows = options.dedupe ? await this.dedupeNotes() : 0;
    const referenceResolution = await this.populateReferenceAudit();

    return {
      options,
      totals: plan.totals,
      execution: {
        importedTargets: runResults.filter((item) => item.status === 'IMPORTED')
          .length,
        skippedTargets: runResults.filter((item) => item.status === 'SKIPPED')
          .length,
        failedTargets: runResults.filter((item) => item.status === 'FAILED')
          .length,
        dedupeDeletedRows,
      },
      referenceResolution,
      targets: runResults,
    };
  }

  private async normalizeBackfillOptions(dto: NoteBackfillOptionsDto): Promise<{
    year: number;
    chapters?: string[];
    force: boolean;
    dedupe: boolean;
  }> {
    const defaultYear = await this.resolveDefaultYear();
    const year = dto.year ?? defaultYear;

    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      throw new BadRequestException('year must be a valid 4-digit number');
    }

    const chapters = dto.chapters?.length
      ? Array.from(
          new Set(
            dto.chapters.map((chapter) => this.normalizeChapter(chapter)),
          ),
        )
      : undefined;

    return {
      year,
      chapters,
      force: dto.force ?? false,
      dedupe: dto.dedupe ?? true,
    };
  }

  private normalizeChapter(chapter: string): string {
    const raw = String(chapter || '').trim();
    if (!/^\d{1,2}$/.test(raw)) {
      throw new BadRequestException(
        `Invalid chapter "${chapter}". Expected 1 or 2 digits (for example "58" or "99").`,
      );
    }
    return raw.padStart(2, '0');
  }

  private async buildBackfillPlan(options: {
    year: number;
    chapters?: string[];
    force: boolean;
    dedupe: boolean;
  }): Promise<{
    targets: BackfillPlanTarget[];
    totals: {
      targets: number;
      unresolvedReferences: number;
      existingNotes: number;
      willImport: number;
      willSkip: number;
    };
  }> {
    const unresolvedTargets = await this.loadTargets(options);
    const targetChapters = unresolvedTargets.map((item) => item.chapter);
    const existingCounts = await this.loadExistingNoteCounts(
      options.year,
      targetChapters,
    );

    const targets: BackfillPlanTarget[] = unresolvedTargets.map((target) => {
      const existingNotes = existingCounts.get(target.chapter) ?? 0;
      const action: BackfillTargetAction =
        !options.force && existingNotes > 0 ? 'SKIP_ALREADY_PRESENT' : 'IMPORT';

      return {
        ...target,
        existingNotes,
        action,
      };
    });

    return {
      targets,
      totals: {
        targets: targets.length,
        unresolvedReferences: targets.reduce(
          (sum, target) => sum + target.unresolvedReferences,
          0,
        ),
        existingNotes: targets.reduce(
          (sum, target) => sum + target.existingNotes,
          0,
        ),
        willImport: targets.filter((target) => target.action === 'IMPORT')
          .length,
        willSkip: targets.filter(
          (target) => target.action === 'SKIP_ALREADY_PRESENT',
        ).length,
      },
    };
  }

  private async resolveDefaultYear(): Promise<number> {
    const rows = await this.dataSource.query(`
      SELECT MAX((regexp_match(version, '(?:19|20)\\d{2}'))[1]::int) AS latest_year
      FROM hts
      WHERE is_active = true;
    `);

    return rows[0]?.latest_year || new Date().getFullYear();
  }

  private async loadTargets(options: {
    year: number;
    chapters?: string[];
  }): Promise<BackfillTarget[]> {
    const rows = await this.dataSource.query(
      `
        WITH active_rates AS (
          SELECT hts_number, chapter, version, 'general'::text AS source_column, general AS reference_text
          FROM hts
          WHERE is_active = true
            AND general ~* 'note\\s+[0-9]'
          UNION ALL
          SELECT hts_number, chapter, version, 'other'::text AS source_column, other AS reference_text
          FROM hts
          WHERE is_active = true
            AND other ~* 'note\\s+[0-9]'
        ),
        refs AS (
          SELECT
            hts_number,
            source_column,
            reference_text,
            COALESCE((regexp_match(version, '(?:19|20)\\d{2}'))[1]::int, $1::int) AS inferred_year,
            (regexp_match(reference_text, '(?:u\\.?\\s*s\\.?\\s*)?note[s]?\\s*(?:no\\.?|number)?\\s*([0-9]+[a-z]?(?:\\([a-z0-9ivx]+\\))*)', 'i'))[1] AS note_number,
            COALESCE(
              lpad((regexp_match(reference_text, '\\bchapter\\s+(\\d{1,2})\\b', 'i'))[1], 2, '0'),
              chapter
            ) AS target_chapter
          FROM active_rates
        ),
        unresolved AS (
          SELECT
            r.inferred_year AS year,
            r.target_chapter AS chapter,
            r.note_number
          FROM refs r
          LEFT JOIN LATERAL (
            SELECT n.id
            FROM hts_notes n
            WHERE n.note_number = r.note_number
              AND n.year = r.inferred_year
              AND n.chapter IN (r.target_chapter, '00')
            ORDER BY
              CASE WHEN n.chapter = r.target_chapter THEN 0 ELSE 1 END,
              n.updated_at DESC
            LIMIT 1
          ) n ON true
          WHERE r.note_number IS NOT NULL
            AND n.id IS NULL
        )
        SELECT
          year,
          chapter,
          COUNT(*)::int AS unresolved_references
        FROM unresolved
        GROUP BY year, chapter
        ORDER BY unresolved_references DESC, chapter ASC;
      `,
      [options.year],
    );

    const byChapter = new Map<string, BackfillTarget>();
    for (const row of rows) {
      byChapter.set(row.chapter, {
        year: row.year ?? options.year,
        chapter: row.chapter,
        unresolvedReferences: row.unresolved_references,
      });
    }

    if (options.chapters?.length) {
      return options.chapters.map((chapter) => ({
        year: options.year,
        chapter,
        unresolvedReferences: byChapter.get(chapter)?.unresolvedReferences ?? 0,
      }));
    }

    return Array.from(byChapter.values());
  }

  private async loadExistingNoteCounts(
    year: number,
    chapters: string[],
  ): Promise<Map<string, number>> {
    if (!chapters.length) {
      return new Map();
    }

    const rows = await this.dataSource.query(
      `
        SELECT chapter, COUNT(*)::int AS note_count
        FROM hts_notes
        WHERE year = $1
          AND chapter = ANY($2::text[])
        GROUP BY chapter
      `,
      [year, chapters],
    );

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.chapter, row.note_count);
    }

    return counts;
  }

  private async countNotesForTarget(
    year: number,
    chapter: string,
  ): Promise<number> {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*)::int AS count
        FROM hts_notes
        WHERE year = $1
          AND chapter = $2
      `,
      [year, chapter],
    );

    return rows[0]?.count ?? 0;
  }

  private async dedupeNotes(): Promise<number> {
    const rows = await this.dataSource.query(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY year, chapter, type, note_number
            ORDER BY updated_at DESC, created_at DESC, id DESC
          ) AS rank_no
        FROM hts_notes
      ),
      deleted AS (
        DELETE FROM hts_notes n
        USING ranked r
        WHERE n.id = r.id
          AND r.rank_no > 1
        RETURNING n.id
      )
      SELECT COUNT(*)::int AS deleted_count FROM deleted;
    `);

    return rows[0]?.deleted_count ?? 0;
  }

  private parseYearFromVersion(
    version: string | null | undefined,
  ): number | undefined {
    if (!version) {
      return undefined;
    }

    const match = version.match(/(19|20)\d{2}/);
    if (!match) {
      return undefined;
    }

    return parseInt(match[0], 10);
  }

  private async populateReferenceAudit(): Promise<{
    total: number;
    resolved: number;
    unresolved: number;
  }> {
    const rows = await this.dataSource.query(`
      SELECT hts_number, version, general, other
      FROM hts
      WHERE is_active = true
        AND (
          general ~* 'note\\s+[0-9]'
          OR other ~* 'note\\s+[0-9]'
        )
      ORDER BY hts_number ASC;
    `);

    let total = 0;
    let resolved = 0;
    let unresolved = 0;

    for (const row of rows) {
      const year = this.parseYearFromVersion(row.version);

      if (row.general && /note\s+[0-9]/i.test(row.general)) {
        total += 1;
        const result = await this.noteResolutionService.resolveNoteReference(
          row.hts_number,
          row.general,
          'general',
          year,
          { exactOnly: true },
        );
        if (result?.metadata?.noteId) {
          resolved += 1;
        } else {
          unresolved += 1;
        }
      }

      if (row.other && /note\s+[0-9]/i.test(row.other)) {
        total += 1;
        const result = await this.noteResolutionService.resolveNoteReference(
          row.hts_number,
          row.other,
          'other',
          year,
          { exactOnly: true },
        );
        if (result?.metadata?.noteId) {
          resolved += 1;
        } else {
          unresolved += 1;
        }
      }
    }

    return { total, resolved, unresolved };
  }
}
