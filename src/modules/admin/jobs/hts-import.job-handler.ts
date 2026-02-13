/**
 * HTS Import Job Handler
 * Processes HTS imports asynchronously using pg-boss
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsImportHistoryEntity } from '@hts/core';
import { HtsProcessorService } from '@hts/core';
import { HtsImportService } from '../services/hts-import.service';
import axios from 'axios';

@Injectable()
export class HtsImportJobHandler {
  private readonly logger = new Logger(HtsImportJobHandler.name);

  constructor(
    @InjectRepository(HtsImportHistoryEntity)
    private importHistoryRepo: Repository<HtsImportHistoryEntity>,
    private htsProcessor: HtsProcessorService,
    private htsImportService: HtsImportService,
  ) {}

  /**
   * Execute import job
   */
  async execute(job: { data: { importId: string } }): Promise<void> {
    const { importId } = job.data;

    this.logger.log(`Starting import job for import ID: ${importId}`);

    try {
      // Get import record
      const importHistory = await this.htsImportService.findOne(importId);

      // Update status to IN_PROGRESS
      await this.htsImportService.updateStatus(importId, 'IN_PROGRESS');
      await this.htsImportService.appendLog(importId, 'Import job started');

      // Download data
      await this.htsImportService.appendLog(
        importId,
        `Downloading data from: ${importHistory.sourceUrl}`,
      );

      const data = await this.downloadUsitcData(importHistory.sourceUrl);

      await this.htsImportService.appendLog(importId, 'Download completed');

      // Count total entries
      const totalEntries = this.countEntries(data);
      await this.htsImportService.updateCounters(importId, { totalEntries });
      await this.htsImportService.appendLog(importId, `Total entries: ${totalEntries}`);

      // Process data
      await this.htsImportService.appendLog(importId, 'Processing HTS entries...');

      const result = await this.htsProcessor.processUsitcData(
        data,
        importHistory.sourceVersion,
      );

      this.logger.log(
        `Import ${importId} processing complete: ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
      );

      // Update counters
      await this.htsImportService.updateCounters(importId, {
        importedEntries: result.created,
        updatedEntries: result.updated,
        skippedEntries: result.skipped,
        failedEntries: result.failed,
      });

      // Add failed entries
      if (result.errors && result.errors.length > 0) {
        for (const error of result.errors) {
          await this.htsImportService.addFailedEntry(
            importId,
            error.htsNumber,
            error.error,
          );
        }
      }

      // Mark as completed
      await this.htsImportService.updateStatus(importId, 'COMPLETED');
      await this.htsImportService.appendLog(
        importId,
        `Import completed successfully. Created: ${result.created}, Updated: ${result.updated}, Failed: ${result.failed}`,
      );

      this.logger.log(`Import job ${importId} completed successfully`);
    } catch (error) {
      this.logger.error(`Import job ${importId} failed: ${error.message}`, error.stack);

      // Mark as failed
      await this.htsImportService.updateStatus(
        importId,
        'FAILED',
        error.message,
        error.stack,
      );
      await this.htsImportService.appendLog(importId, `Import failed: ${error.message}`);
    }
  }

  /**
   * Download USITC data from URL
   */
  private async downloadUsitcData(url: string): Promise<any> {
    try {
      const response = await axios.get(url, {
        timeout: 300000, // 5 minutes timeout
        maxContentLength: 100 * 1024 * 1024, // 100MB max
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to download USITC data: ${error.message}`);
    }
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
