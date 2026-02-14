/**
 * HTS Import Job Handler - PRODUCTION-READY VERSION
 *
 * Features:
 * - Downloads USITC data to S3 (not memory)
 * - Multi-stage processing with checkpoints
 * - Crash recovery - resumes from last checkpoint
 * - Batch processing with transaction safety
 * - Cluster-safe with pg-boss singleton jobs
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsImportHistoryEntity, HtsEntity, HtsProcessorService, S3StorageService } from '@hts/core';
import { HtsImportService } from '../services/hts-import.service';
import axios from 'axios';
import { Readable } from 'stream';

interface ImportCheckpoint {
  stage: 'DOWNLOADING' | 'DOWNLOADED' | 'PROCESSING' | 'COMPLETED';
  downloadedBytes?: number;
  s3Key?: string;
  s3Bucket?: string;
  fileHash?: string;
  processedBatches?: number;
  totalBatches?: number;
  lastProcessedChapter?: string;
  processedRecords?: number;
}

@Injectable()
export class HtsImportJobHandler {
  private readonly logger = new Logger(HtsImportJobHandler.name);
  private readonly BATCH_SIZE = 1000; // Process 1000 records per batch
  private readonly S3_BUCKET: string;

  constructor(
    @InjectRepository(HtsImportHistoryEntity)
    private importHistoryRepo: Repository<HtsImportHistoryEntity>,
    @InjectRepository(HtsEntity)
    private htsRepo: Repository<HtsEntity>,
    private htsProcessor: HtsProcessorService,
    private htsImportService: HtsImportService,
    private s3Storage: S3StorageService,
  ) {
    this.S3_BUCKET = this.s3Storage.getDefaultBucket();
  }

  /**
   * Execute import job with full crash recovery support
   * Can resume from any stage if application restarts
   */
  async execute(job: any): Promise<void> {
    const { importId } = job.data;

    this.logger.log(`Starting HTS import job: ${importId}`);

    try {
      // Get import record
      const importHistory = await this.htsImportService.findOne(importId);

      // Load checkpoint (if exists from previous crash)
      const checkpoint: ImportCheckpoint = (importHistory.checkpoint as ImportCheckpoint) || {
        stage: 'DOWNLOADING',
      };

      this.logger.log(
        `Import ${importId}: Resuming from stage: ${checkpoint.stage}` +
        (checkpoint.processedBatches ? ` (${checkpoint.processedBatches} batches completed)` : '')
      );

      // ====== STAGE 1: DOWNLOAD TO S3 ======
      if (checkpoint.stage === 'DOWNLOADING') {
        await this.downloadToS3(importHistory, checkpoint);

        // Save checkpoint after successful download
        checkpoint.stage = 'DOWNLOADED';
        await this.saveCheckpoint(importId, checkpoint);
        await this.htsImportService.appendLog(importId, '✓ Download stage completed');
      }

      // ====== STAGE 2: PROCESS FROM S3 ======
      if (checkpoint.stage === 'DOWNLOADED') {
        checkpoint.stage = 'PROCESSING';
        checkpoint.processedBatches = 0;
        checkpoint.processedRecords = 0;
        await this.saveCheckpoint(importId, checkpoint);
        await this.htsImportService.appendLog(importId, 'Starting processing stage...');
      }

      if (checkpoint.stage === 'PROCESSING') {
        await this.processFromS3(importHistory, checkpoint);

        // Mark as completed
        checkpoint.stage = 'COMPLETED';
        await this.saveCheckpoint(importId, checkpoint);
      }

      // Final status update
      await this.htsImportService.updateStatus(importId, 'COMPLETED');
      await this.htsImportService.appendLog(
        importId,
        `✓ Import completed successfully (${checkpoint.processedRecords || 0} records processed)`
      );

      this.logger.log(`Import job ${importId} completed successfully`);
    } catch (error) {
      this.logger.error(`Import job ${importId} failed: ${error.message}`, error.stack);

      // Mark as failed (pg-boss will retry automatically)
      await this.htsImportService.updateStatus(
        importId,
        'FAILED',
        error.message,
        error.stack,
      );
      await this.htsImportService.appendLog(importId, `✗ Import failed: ${error.message}`);

      throw error; // Let pg-boss handle retry
    }
  }

  /**
   * STAGE 1: Download USITC data to S3
   * - Streams data directly to S3 (no memory bloat)
   * - Calculates SHA-256 hash during upload
   * - Skips download if file already exists in S3
   */
  private async downloadToS3(
    importHistory: HtsImportHistoryEntity,
    checkpoint: ImportCheckpoint,
  ): Promise<void> {
    const s3Key = `hts/raw/${importHistory.sourceVersion}.json`;

    // Check if already downloaded to S3
    if (await this.s3Storage.exists(this.S3_BUCKET, s3Key)) {
      this.logger.log(`File already exists in S3: ${s3Key}, skipping download`);

      const metadata = await this.s3Storage.getMetadata(this.S3_BUCKET, s3Key);
      checkpoint.s3Key = s3Key;
      checkpoint.s3Bucket = this.S3_BUCKET;
      checkpoint.downloadedBytes = metadata.size;
      checkpoint.fileHash = metadata.metadata.sha256 || '';

      // Update import history with S3 info
      await this.importHistoryRepo.update(importHistory.id, {
        s3Bucket: this.S3_BUCKET,
        s3Key: s3Key,
        s3FileHash: checkpoint.fileHash,
        downloadedAt: metadata.lastModified,
        downloadSizeBytes: metadata.size,
      });

      await this.htsImportService.appendLog(
        importHistory.id,
        `Using existing S3 file: ${s3Key} (${(metadata.size / 1024 / 1024).toFixed(2)} MB)`
      );
      return;
    }

    // Download from USITC with streaming
    await this.htsImportService.updateStatus(importHistory.id, 'IN_PROGRESS');
    await this.htsImportService.appendLog(
      importHistory.id,
      `Downloading from USITC: ${importHistory.sourceUrl}`
    );

    this.logger.log(`Downloading ${importHistory.sourceVersion} from ${importHistory.sourceUrl}`);

    const response = await axios.get(importHistory.sourceUrl, {
      responseType: 'stream',
      timeout: 600000, // 10 minutes timeout
      maxContentLength: Infinity, // No size limit (stream to S3)
      maxBodyLength: Infinity,
    });

    const stream = response.data as Readable;

    // Upload to S3 with hash calculation
    const uploadResult = await this.s3Storage.uploadStream({
      bucket: this.S3_BUCKET,
      key: s3Key,
      stream,
      contentType: 'application/json',
      metadata: {
        version: importHistory.sourceVersion,
        importId: importHistory.id,
        downloadedAt: new Date().toISOString(),
        sourceUrl: importHistory.sourceUrl,
      },
    });

    // Save checkpoint with S3 info
    checkpoint.s3Key = s3Key;
    checkpoint.s3Bucket = this.S3_BUCKET;
    checkpoint.downloadedBytes = uploadResult.size;
    checkpoint.fileHash = uploadResult.sha256;

    // Update import history
    await this.importHistoryRepo.update(importHistory.id, {
      sourceFileHash: uploadResult.sha256,
      s3Bucket: this.S3_BUCKET,
      s3Key: s3Key,
      s3FileHash: uploadResult.sha256,
      downloadedAt: new Date(),
      downloadSizeBytes: uploadResult.size,
    });

    await this.htsImportService.appendLog(
      importHistory.id,
      `Download completed: ${(uploadResult.size / 1024 / 1024).toFixed(2)} MB, ` +
      `SHA-256: ${uploadResult.sha256?.substring(0, 12)}...`
    );

    this.logger.log(`Downloaded ${importHistory.sourceVersion} to S3: ${s3Key}`);
  }

  /**
   * STAGE 2: Process data from S3 with batching and checkpoints
   * - Processes in batches of 1000 records
   * - Saves checkpoint after each batch
   * - Can resume from last processed batch on crash
   * - Uses transactions for data integrity
   */
  private async processFromS3(
    importHistory: HtsImportHistoryEntity,
    checkpoint: ImportCheckpoint,
  ): Promise<void> {
    const { s3Key, s3Bucket } = checkpoint;

    if (!s3Key || !s3Bucket) {
      throw new Error('S3 key and bucket not found in checkpoint');
    }

    this.logger.log(`Processing from S3: s3://${s3Bucket}/${s3Key}`);

    await this.htsImportService.appendLog(
      importHistory.id,
      `Processing HTS entries from S3...`
    );

    // Download and parse JSON from S3
    const stream = await this.s3Storage.downloadStream(s3Bucket, s3Key);
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }

    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

    // Count total entries
    const totalEntries = this.countEntries(data);
    await this.htsImportService.updateCounters(importHistory.id, { totalEntries });
    await this.htsImportService.appendLog(
      importHistory.id,
      `Total entries to process: ${totalEntries.toLocaleString()}`
    );

    // Initialize counters
    let processedCount = checkpoint.processedRecords || 0;
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let batchNumber = checkpoint.processedBatches || 0;

    const chapters = Object.entries(data.chapters || data);
    const totalBatches = Math.ceil(totalEntries / this.BATCH_SIZE);

    checkpoint.totalBatches = totalBatches;

    this.logger.log(
      `Processing ${totalEntries} entries in ${totalBatches} batches of ${this.BATCH_SIZE}`
    );

    // Process chapters
    for (const [chapterKey, items] of chapters) {
      // Skip if already processed (resume scenario)
      if (checkpoint.lastProcessedChapter && chapterKey < checkpoint.lastProcessedChapter) {
        this.logger.log(`Skipping already processed chapter: ${chapterKey}`);
        continue;
      }

      if (!Array.isArray(items)) continue;

      const chapterStartIndex = checkpoint.lastProcessedChapter === chapterKey
        ? (checkpoint.processedRecords || 0) % this.BATCH_SIZE
        : 0;

      // Process chapter items in batches
      for (let i = chapterStartIndex; i < items.length; i += this.BATCH_SIZE) {
        const batch = items.slice(i, i + this.BATCH_SIZE);
        const batchStartTime = Date.now();

        try {
          // Process batch in transaction
          const batchResult = await this.htsRepo.manager.transaction(
            async (transactionalEntityManager) => {
              let batchImported = 0;
              let batchUpdated = 0;
              let batchSkipped = 0;

              for (const item of batch) {
                try {
                  const result = await this.processSingleEntry(
                    item,
                    importHistory.sourceVersion,
                    transactionalEntityManager,
                  );

                  if (result === 'CREATED') batchImported++;
                  else if (result === 'UPDATED') batchUpdated++;
                  else if (result === 'SKIPPED') batchSkipped++;
                } catch (error) {
                  this.logger.error(`Failed to process entry: ${error.message}`);
                  throw error; // Rollback entire batch
                }
              }

              return { batchImported, batchUpdated, batchSkipped };
            }
          );

          importedCount += batchResult.batchImported;
          updatedCount += batchResult.batchUpdated;
          skippedCount += batchResult.batchSkipped;
          processedCount += batch.length;
          batchNumber++;

          const batchDuration = Date.now() - batchStartTime;
          const percentComplete = Math.round((processedCount / totalEntries) * 100);

          // Update checkpoint after each successful batch
          checkpoint.processedBatches = batchNumber;
          checkpoint.lastProcessedChapter = chapterKey;
          checkpoint.processedRecords = processedCount;
          await this.saveCheckpoint(importHistory.id, checkpoint);

          // Update counters
          await this.htsImportService.updateCounters(importHistory.id, {
            importedEntries: importedCount,
            updatedEntries: updatedCount,
            skippedEntries: skippedCount,
          });

          this.logger.log(
            `Batch ${batchNumber}/${totalBatches} completed in ${batchDuration}ms: ` +
            `${processedCount.toLocaleString()}/${totalEntries.toLocaleString()} (${percentComplete}%) ` +
            `[+${batchResult.batchImported} ~${batchResult.batchUpdated} =${batchResult.batchSkipped}]`
          );

          // Log progress every 10 batches
          if (batchNumber % 10 === 0) {
            await this.htsImportService.appendLog(
              importHistory.id,
              `Progress: ${processedCount.toLocaleString()}/${totalEntries.toLocaleString()} ` +
              `(${percentComplete}%) - Batch ${batchNumber}/${totalBatches}`
            );
          }
        } catch (error) {
          this.logger.error(`Batch ${batchNumber} failed: ${error.message}`, error.stack);
          failedCount += batch.length;

          // Log failed batch (but continue processing)
          await this.htsImportService.addFailedEntry(
            importHistory.id,
            `Batch ${batchNumber} (Chapter ${chapterKey})`,
            error.message
          );

          // Still update checkpoint to skip this failed batch on retry
          checkpoint.processedBatches = batchNumber;
          checkpoint.lastProcessedChapter = chapterKey;
          checkpoint.processedRecords = processedCount;
          await this.saveCheckpoint(importHistory.id, checkpoint);
        }
      }

      // Update checkpoint after each chapter
      checkpoint.lastProcessedChapter = chapterKey;
      await this.saveCheckpoint(importHistory.id, checkpoint);
    }

    // Final update
    await this.htsImportService.updateCounters(importHistory.id, {
      importedEntries: importedCount,
      updatedEntries: updatedCount,
      skippedEntries: skippedCount,
      failedEntries: failedCount,
    });

    await this.htsImportService.appendLog(
      importHistory.id,
      `✓ Processing completed: ${importedCount.toLocaleString()} imported, ` +
      `${updatedCount.toLocaleString()} updated, ${skippedCount.toLocaleString()} skipped, ` +
      `${failedCount.toLocaleString()} failed`
    );

    this.logger.log(
      `Import ${importHistory.id} processing complete: ` +
      `${importedCount} imported, ${updatedCount} updated, ${failedCount} failed`
    );
  }

  /**
   * Process single HTS entry (UPSERT operation for idempotency)
   */
  private async processSingleEntry(
    item: any,
    sourceVersion: string,
    entityManager: any,
  ): Promise<'CREATED' | 'UPDATED' | 'SKIPPED'> {
    // Use HtsProcessorService or implement UPSERT logic here
    // This ensures idempotency - same entry processed twice = same result

    const htsNumber = item.htsNumber || item.hts_number;

    if (!htsNumber) {
      throw new Error('HTS number missing from entry');
    }

    // Check if entry exists
    const existing = await entityManager.findOne(HtsEntity, {
      where: { htsNumber },
    });

    if (existing) {
      // Update if changed
      const hasChanges = this.hasChanges(existing, item, sourceVersion);

      if (hasChanges) {
        await entityManager.update(HtsEntity, { htsNumber }, {
          ...this.mapItemToEntity(item, sourceVersion),
          updatedAt: new Date(),
        });
        return 'UPDATED';
      } else {
        return 'SKIPPED';
      }
    } else {
      // Create new entry
      const entity = entityManager.create(HtsEntity, this.mapItemToEntity(item, sourceVersion));
      await entityManager.save(HtsEntity, entity);
      return 'CREATED';
    }
  }

  /**
   * Check if entry has changes
   */
  private hasChanges(existing: HtsEntity, item: any, sourceVersion: string): boolean {
    // Simple check - compare source version
    return existing.sourceVersion !== sourceVersion;
  }

  /**
   * Map raw item to HTS entity
   */
  private mapItemToEntity(item: any, sourceVersion: string): Partial<HtsEntity> {
    return {
      htsNumber: item.htsNumber || item.hts_number,
      indent: item.indent || 0,
      description: item.description || '',
      unit: item.unit || '',
      generalRate: item.generalRate || item.general_rate || '',
      specialRates: item.specialRates || (item.special_rate ? { default: item.special_rate } : null),
      sourceVersion: sourceVersion,
      chapter: item.chapter || item.htsNumber?.substring(0, 2),
      parentHtsNumber: item.parentHtsNumber || item.parent_hts_number || null,
    };
  }

  /**
   * Save checkpoint to database
   */
  private async saveCheckpoint(importId: string, checkpoint: ImportCheckpoint): Promise<void> {
    await this.importHistoryRepo.update(importId, {
      checkpoint: checkpoint as any,
    });
  }

  /**
   * Count total entries in dataset
   */
  private countEntries(data: any): number {
    const chapters = data.chapters || data;
    let count = 0;

    for (const items of Object.values(chapters)) {
      if (Array.isArray(items)) {
        count += items.length;
      }
    }

    return count;
  }
}
