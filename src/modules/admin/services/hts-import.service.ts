/**
 * HTS Import Service
 * Business logic for HTS import management
 */

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsImportHistoryEntity } from '@hts/core';
import { HtsEntity } from '@hts/core';
import { QueueService } from '../../queue/queue.service';
import { TriggerImportDto, ListImportsDto } from '../dto/hts-import.dto';

@Injectable()
export class HtsImportService {
  private readonly logger = new Logger(HtsImportService.name);

  constructor(
    @InjectRepository(HtsImportHistoryEntity)
    private importHistoryRepo: Repository<HtsImportHistoryEntity>,
    @InjectRepository(HtsEntity)
    private htsRepo: Repository<HtsEntity>,
    private queueService: QueueService,
  ) {}

  /**
   * Create a new import record and trigger async job
   */
  async createImport(dto: TriggerImportDto, userId: string): Promise<HtsImportHistoryEntity> {
    // Check for duplicate import
    const existing = await this.importHistoryRepo.findOne({
      where: { sourceVersion: dto.sourceVersion, status: 'IN_PROGRESS' },
    });

    if (existing) {
      throw new BadRequestException(
        `Import for version "${dto.sourceVersion}" is already in progress`,
      );
    }

    // Create import history record
    const importHistory = this.importHistoryRepo.create({
      sourceVersion: dto.sourceVersion,
      sourceUrl: dto.sourceUrl,
      sourceFileHash: dto.sourceFileHash || null,
      status: 'PENDING',
      startedBy: userId,
      importLog: [],
    });

    const saved = await this.importHistoryRepo.save(importHistory);
    this.logger.log(`Created import record: ${saved.id} for version ${saved.sourceVersion}`);

    // Trigger async job
    await this.queueService.sendJob('hts-import', { importId: saved.id });

    return saved;
  }

  /**
   * Find all imports with pagination and filters
   */
  async findAll(dto: ListImportsDto): Promise<{
    data: HtsImportHistoryEntity[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const { page, pageSize, status, sourceVersion } = dto;

    const query = this.importHistoryRepo.createQueryBuilder('import');

    if (status) {
      query.andWhere('import.status = :status', { status });
    }

    if (sourceVersion) {
      query.andWhere('import.sourceVersion = :sourceVersion', { sourceVersion });
    }

    query.orderBy('import.createdAt', 'DESC');

    const [data, total] = await query
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Find one import by ID
   */
  async findOne(id: string): Promise<HtsImportHistoryEntity> {
    const importHistory = await this.importHistoryRepo.findOne({ where: { id } });

    if (!importHistory) {
      throw new NotFoundException(`Import record not found: ${id}`);
    }

    return importHistory;
  }

  /**
   * Get import logs with pagination
   */
  async getLogs(id: string, offset: number, limit: number): Promise<string[]> {
    const importHistory = await this.findOne(id);

    if (!importHistory.importLog || importHistory.importLog.length === 0) {
      return [];
    }

    return importHistory.importLog.slice(offset, offset + limit);
  }

  /**
   * Get failed entries
   */
  async getFailedEntries(id: string): Promise<Array<{ htsNumber: string; error: string }>> {
    const importHistory = await this.findOne(id);

    return importHistory.failedEntriesDetail || [];
  }

  /**
   * Rollback a completed import
   */
  async rollback(id: string, userId: string): Promise<void> {
    const importHistory = await this.findOne(id);

    if (importHistory.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Can only rollback completed imports. Current status: ${importHistory.status}`,
      );
    }

    this.logger.log(`Rolling back import ${id} for version ${importHistory.sourceVersion}`);

    // Delete all HTS entries with matching sourceVersion
    const result = await this.htsRepo.delete({
      sourceVersion: importHistory.sourceVersion,
    });

    this.logger.log(`Deleted ${result.affected || 0} HTS entries`);

    // Update import history
    await this.importHistoryRepo.update(id, {
      status: 'ROLLED_BACK',
      rollbackInfo: {
        rolledBackAt: new Date(),
        rolledBackBy: userId,
        deletedEntryCount: result.affected || 0,
        rollbackMethod: 'DELETE_BY_VERSION',
      },
    });

    this.logger.log(`Rollback completed for import ${id}`);
  }

  /**
   * Append log entry to import history
   * Used by job handler to update logs in real-time
   */
  async appendLog(importId: string, message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${message}`;

    await this.importHistoryRepo
      .createQueryBuilder()
      .update(HtsImportHistoryEntity)
      .set({
        importLog: () => "COALESCE(import_log, '[]'::jsonb) || :newLog::jsonb",
      })
      .setParameter('newLog', JSON.stringify([logEntry]))
      .where('id = :id', { id: importId })
      .execute();
  }

  /**
   * Update import status
   * Used by job handler to update status
   */
  async updateStatus(
    importId: string,
    status: string,
    errorMessage?: string,
    errorStack?: string,
  ): Promise<void> {
    const updateData: any = { status };

    if (status === 'IN_PROGRESS') {
      updateData.importStartedAt = new Date();
    } else if (status === 'COMPLETED' || status === 'FAILED') {
      updateData.importCompletedAt = new Date();

      // Calculate duration
      const importHistory = await this.findOne(importId);
      if (importHistory.importStartedAt) {
        const startTime = new Date(importHistory.importStartedAt).getTime();
        const endTime = new Date().getTime();
        updateData.durationSeconds = Math.round((endTime - startTime) / 1000);
      }
    }

    if (errorMessage) {
      updateData.errorMessage = errorMessage;
      updateData.errorStack = errorStack || null;
    }

    await this.importHistoryRepo.update(importId, updateData);
  }

  /**
   * Update import counters
   * Used by job handler to track progress
   */
  async updateCounters(
    importId: string,
    counters: {
      totalEntries?: number;
      importedEntries?: number;
      updatedEntries?: number;
      skippedEntries?: number;
      failedEntries?: number;
    },
  ): Promise<void> {
    await this.importHistoryRepo.update(importId, counters);
  }

  /**
   * Add failed entry detail
   * Used by job handler to track failed entries
   */
  async addFailedEntry(importId: string, htsNumber: string, error: string): Promise<void> {
    await this.importHistoryRepo
      .createQueryBuilder()
      .update(HtsImportHistoryEntity)
      .set({
        failedEntriesDetail: () =>
          "COALESCE(failed_entries_detail, '[]'::jsonb) || :newEntry::jsonb",
      })
      .setParameter('newEntry', JSON.stringify([{ htsNumber, error }]))
      .where('id = :id', { id: importId })
      .execute();
  }
}
