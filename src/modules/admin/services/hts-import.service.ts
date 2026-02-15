/**
 * HTS Import Service
 * Business logic for HTS import management
 */

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  HtsImportHistoryEntity,
  HtsEntity,
  HtsSettingEntity,
  HtsStageEntryEntity,
  HtsStageValidationIssueEntity,
  HtsStageDiffEntity,
  UsitcDownloaderService,
} from '@hts/core';
import { QueueService } from '../../queue/queue.service';
import {
  TriggerImportDto,
  ListImportsDto,
  StageValidationQueryDto,
  StageDiffQueryDto,
} from '../dto/hts-import.dto';

@Injectable()
export class HtsImportService {
  private readonly logger = new Logger(HtsImportService.name);

  constructor(
    @InjectRepository(HtsImportHistoryEntity)
    private importHistoryRepo: Repository<HtsImportHistoryEntity>,
    @InjectRepository(HtsEntity)
    private htsRepo: Repository<HtsEntity>,
    @InjectRepository(HtsSettingEntity)
    private htsSettingRepo: Repository<HtsSettingEntity>,
    @InjectRepository(HtsStageEntryEntity)
    private htsStageRepo: Repository<HtsStageEntryEntity>,
    @InjectRepository(HtsStageValidationIssueEntity)
    private htsStageIssueRepo: Repository<HtsStageValidationIssueEntity>,
    @InjectRepository(HtsStageDiffEntity)
    private htsStageDiffRepo: Repository<HtsStageDiffEntity>,
    private usitcDownloader: UsitcDownloaderService,
    private queueService: QueueService,
  ) {}

  /**
   * Create a new import record and trigger async job
   * Supports simplified API: version="latest" OR year+revision
   */
  async createImport(dto: TriggerImportDto, userId: string): Promise<HtsImportHistoryEntity> {
    let sourceUrl: string;
    let sourceVersion: string;

    // Handle simplified API
    if (dto.version === 'latest' || (!dto.sourceUrl && !dto.year)) {
      // Auto-detect latest revision
      this.logger.log('Auto-detecting latest HTS revision...');
      const latest = await this.usitcDownloader.findLatestRevision();

      if (!latest) {
        throw new BadRequestException('Could not find any available HTS data');
      }

      sourceUrl = latest.jsonUrl;
      sourceVersion = `${latest.year}_revision_${latest.revision}`;
      this.logger.log(`Found latest: ${sourceVersion}`);
    } else if (dto.year && dto.revision) {
      // Specific year + revision
      sourceUrl = this.usitcDownloader.getDownloadUrl(dto.year, dto.revision);
      sourceVersion = `${dto.year}_revision_${dto.revision}`;
    } else if (dto.sourceUrl && dto.sourceVersion) {
      // Legacy support: explicit URL + version
      sourceUrl = dto.sourceUrl;
      sourceVersion = dto.sourceVersion;
    } else {
      throw new BadRequestException(
        'Must specify either: version="latest", year+revision, or sourceUrl+sourceVersion'
      );
    }

    // Check for duplicate import
    const existing = await this.importHistoryRepo.findOne({
      where: { sourceVersion, status: 'IN_PROGRESS' },
    });

    if (existing) {
      throw new BadRequestException(
        `Import for version "${sourceVersion}" is already in progress`,
      );
    }

    // Create import history record
    const importHistory = this.importHistoryRepo.create({
      sourceVersion,
      sourceUrl,
      sourceFileHash: null,
      status: 'PENDING',
      startedBy: userId,
      importLog: [],
    });

    const saved = await this.importHistoryRepo.save(importHistory);
    this.logger.log(`Created import record: ${saved.id} for version ${saved.sourceVersion}`);

    // Trigger async job with singleton key for cluster safety
    const jobId = await this.queueService.sendJob(
      'hts-import',
      { importId: saved.id },
      {
        singletonKey: `hts-import-${saved.sourceVersion}`,
        retryLimit: 3,
        expireInSeconds: 7200,
      },
    );

    this.logger.log(`Triggered HTS import job ${jobId} for version ${saved.sourceVersion}`);

    saved.jobId = jobId;
    await this.importHistoryRepo.save(saved);

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
    const { status, sourceVersion } = dto;
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

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
    importHistory.status = 'ROLLED_BACK';
    importHistory.rollbackInfo = {
      rolledBackAt: new Date().toISOString(),
      rolledBackBy: userId,
      deletedEntryCount: result.affected || 0,
      rollbackMethod: 'DELETE_BY_VERSION',
    };
    await this.importHistoryRepo.save(importHistory);

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

  /**
   * Get staging summary for an import
   */
  async getStageSummary(importId: string): Promise<{
    stagedCount: number;
    validationCounts: Record<string, number>;
    diffCounts: Record<string, number>;
  }> {
    await this.findOne(importId);

    const stagedCount = await this.htsStageRepo.count({ where: { importId } });

    const validationRows = await this.htsStageIssueRepo
      .createQueryBuilder('issue')
      .select('issue.severity', 'severity')
      .addSelect('COUNT(*)', 'count')
      .where('issue.importId = :importId', { importId })
      .groupBy('issue.severity')
      .getRawMany();

    const diffRows = await this.htsStageDiffRepo
      .createQueryBuilder('diff')
      .select('diff.diffType', 'diffType')
      .addSelect('COUNT(*)', 'count')
      .where('diff.importId = :importId', { importId })
      .groupBy('diff.diffType')
      .getRawMany();

    const validationCounts: Record<string, number> = {};
    for (const row of validationRows) {
      validationCounts[row.severity] = parseInt(row.count, 10);
    }

    const diffCounts: Record<string, number> = {};
    for (const row of diffRows) {
      diffCounts[row.diffType] = parseInt(row.count, 10);
    }

    return { stagedCount, validationCounts, diffCounts };
  }

  /**
   * Get staging validation issues
   */
  async getStageValidationIssues(
    importId: string,
    query: StageValidationQueryDto,
  ): Promise<{ data: HtsStageValidationIssueEntity[]; meta: Record<string, any> }> {
    await this.findOne(importId);

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;

    const qb = this.htsStageIssueRepo.createQueryBuilder('issue')
      .where('issue.importId = :importId', { importId });

    if (query.severity) {
      qb.andWhere('issue.severity = :severity', { severity: query.severity });
    }

    const [data, total] = await qb
      .orderBy('issue.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      meta: {
        total,
        offset,
        limit,
      },
    };
  }

  /**
   * Get staging diffs
   */
  async getStageDiffs(
    importId: string,
    query: StageDiffQueryDto,
  ): Promise<{ data: HtsStageDiffEntity[]; meta: Record<string, any> }> {
    await this.findOne(importId);

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;

    const qb = this.htsStageDiffRepo.createQueryBuilder('diff')
      .where('diff.importId = :importId', { importId });

    if (query.diffType) {
      qb.andWhere('diff.diffType = :diffType', { diffType: query.diffType });
    }

    if (query.htsNumber) {
      qb.andWhere('diff.htsNumber = :htsNumber', { htsNumber: query.htsNumber });
    }

    const [data, total] = await qb
      .orderBy('diff.htsNumber', 'ASC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      meta: {
        total,
        offset,
        limit,
      },
    };
  }

  /**
   * Export staging diffs as CSV
   */
  async exportStageDiffsCsv(
    importId: string,
    query: StageDiffQueryDto,
  ): Promise<string> {
    await this.findOne(importId);

    const qb = this.htsStageDiffRepo.createQueryBuilder('diff')
      .where('diff.importId = :importId', { importId });

    if (query.diffType) {
      qb.andWhere('diff.diffType = :diffType', { diffType: query.diffType });
    }

    if (query.htsNumber) {
      qb.andWhere('diff.htsNumber = :htsNumber', { htsNumber: query.htsNumber });
    }

    const diffs = await qb.orderBy('diff.htsNumber', 'ASC').getMany();

    const header = [
      'htsNumber',
      'diffType',
      'changedFields',
      'current',
      'staged',
      'extraTaxes',
      'diffSummary',
    ];

    const rows = diffs.map((diff) => {
      const summary = diff.diffSummary || {};
      const changedFields = summary.changes ? Object.keys(summary.changes).join('|') : '';
      const current = summary.current ?? null;
      const staged = summary.staged ?? null;
      const extraTaxes = summary.extraTaxes ?? null;

      return [
        diff.htsNumber,
        diff.diffType,
        changedFields,
        JSON.stringify(current),
        JSON.stringify(staged),
        JSON.stringify(extraTaxes),
        JSON.stringify(summary),
      ];
    });

    return this.buildCsv([header, ...rows]);
  }

  private buildCsv(rows: string[][]): string {
    return rows
      .map((row) => row.map((value) => this.escapeCsv(value ?? '')).join(','))
      .join('\n');
  }

  private escapeCsv(value: string): string {
    const str = value.toString();
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Promote staged import to production HTS
   */
  async promoteImport(
    importId: string,
    userId: string,
    canOverrideValidation: boolean,
  ): Promise<HtsImportHistoryEntity> {
    const importHistory = await this.findOne(importId);

    if (importHistory.status === 'COMPLETED') {
      throw new BadRequestException('Import is already completed');
    }

    if (importHistory.status === 'IN_PROGRESS') {
      throw new BadRequestException('Import is currently in progress');
    }

    const validationSummary = await this.htsStageIssueRepo
      .createQueryBuilder('issue')
      .select('issue.severity', 'severity')
      .addSelect('COUNT(*)', 'count')
      .where('issue.importId = :importId', { importId })
      .groupBy('issue.severity')
      .getRawMany();

    const errorCount = validationSummary
      .filter((row) => row.severity === 'ERROR')
      .reduce((sum, row) => sum + parseInt(row.count, 10), 0);

    if (errorCount > 0 && !canOverrideValidation) {
      throw new BadRequestException(
        'Validation errors present. Override permission required to promote.',
      );
    }

    const metadata = importHistory.metadata || {};
    if (errorCount > 0 && canOverrideValidation) {
      metadata.validationOverride = true;
      metadata.validationOverrideBy = userId;
      metadata.validationOverrideAt = new Date().toISOString();
    }

    await this.importHistoryRepo.update(importId, {
      metadata,
      status: 'PENDING',
      errorMessage: null,
      errorStack: null,
    });

    await this.appendLog(
      importId,
      `Promotion requested by ${userId}; validation override enabled`,
    );

    const jobId = await this.queueService.sendJob(
      'hts-import',
      { importId },
      {
        singletonKey: `hts-import-${importHistory.sourceVersion}`,
        retryLimit: 3,
        expireInSeconds: 7200,
      },
    );

    await this.importHistoryRepo.update(importId, { jobId });

    return await this.findOne(importId);
  }

  /**
   * Reject a staged import
   */
  async rejectImport(
    importId: string,
    userId: string,
    reason?: string,
  ): Promise<HtsImportHistoryEntity> {
    const importHistory = await this.findOne(importId);

    if (importHistory.status === 'COMPLETED') {
      throw new BadRequestException('Cannot reject a completed import');
    }

    if (importHistory.status === 'ROLLED_BACK') {
      throw new BadRequestException('Cannot reject a rolled back import');
    }

    const metadata = importHistory.metadata || {};
    metadata.rejectedBy = userId;
    metadata.rejectedAt = new Date().toISOString();
    if (reason) {
      metadata.rejectionReason = reason;
    }

    await this.importHistoryRepo.update(importId, {
      status: 'REJECTED',
      metadata,
    });

    await this.appendLog(
      importId,
      `Import rejected by ${userId}${reason ? `: ${reason}` : ''}`,
    );

    return await this.findOne(importId);
  }

  /**
   * Finalize a successful import
   * - Marks current version setting
   * - Activates current version entries
   * - Deactivates older version entries
   */
  async finalizeSuccessfulImport(
    importHistory: HtsImportHistoryEntity,
  ): Promise<{ deactivatedCount: number }> {
    const sourceVersion = importHistory.sourceVersion;
    const now = new Date();
    const settingKey = 'usitc.current_version';

    const existingSetting = await this.htsSettingRepo.findOne({
      where: { key: settingKey },
    });

    if (existingSetting) {
      existingSetting.value = sourceVersion;
      existingSetting.dataType = 'STRING';
      existingSetting.category = 'usitc';
      existingSetting.description = 'Current active USITC HTS source version';
      existingSetting.lastUpdatedBy = importHistory.startedBy || 'SYSTEM';
      existingSetting.effectiveDate = now;
      await this.htsSettingRepo.save(existingSetting);
    } else {
      const newSetting = this.htsSettingRepo.create({
        key: settingKey,
        value: sourceVersion,
        dataType: 'STRING',
        category: 'usitc',
        description: 'Current active USITC HTS source version',
        isEditable: true,
        lastUpdatedBy: importHistory.startedBy || 'SYSTEM',
        effectiveDate: now,
      });
      await this.htsSettingRepo.save(newSetting);
    }

    await this.htsRepo
      .createQueryBuilder()
      .update(HtsEntity)
      .set({ isActive: true })
      .where('sourceVersion = :version', { version: sourceVersion })
      .execute();

    const deactivated = await this.htsRepo
      .createQueryBuilder()
      .update(HtsEntity)
      .set({ isActive: false })
      .where('sourceVersion != :version', { version: sourceVersion })
      .andWhere('isActive = :isActive', { isActive: true })
      .execute();

    return { deactivatedCount: deactivated.affected || 0 };
  }
}
