/**
 * HTS Import Service
 * Business logic for HTS import management
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  HtsImportHistoryEntity,
  HtsEntity,
  HtsSettingEntity,
  HtsStageEntryEntity,
  HtsStageValidationIssueEntity,
  HtsStageDiffEntity,
  UsitcDownloaderService,
  HtsChapter99FormulaService,
} from '@hts/core';
import type { Chapter99ReferenceInput } from '@hts/core';
import { QueueService } from '../../queue/queue.service';
import {
  TriggerImportDto,
  ListImportsDto,
  StageValidationQueryDto,
  StageDiffQueryDto,
  StageChapter99PreviewQueryDto,
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
    @Optional()
    private readonly htsChapter99FormulaService?: HtsChapter99FormulaService,
  ) {}

  /**
   * Create a new import record and trigger async job
   * Supports simplified API: version="latest" OR year+revision
   */
  async createImport(
    dto: TriggerImportDto,
    userId: string,
  ): Promise<HtsImportHistoryEntity> {
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
        'Must specify either: version="latest", year+revision, or sourceUrl+sourceVersion',
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
    this.logger.log(
      `Created import record: ${saved.id} for version ${saved.sourceVersion}`,
    );

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

    this.logger.log(
      `Triggered HTS import job ${jobId} for version ${saved.sourceVersion}`,
    );

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
      query.andWhere('import.sourceVersion = :sourceVersion', {
        sourceVersion,
      });
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
    const importHistory = await this.importHistoryRepo.findOne({
      where: { id },
    });

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
  async getFailedEntries(
    id: string,
  ): Promise<Array<{ htsNumber: string; error: string }>> {
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

    this.logger.log(
      `Rolling back import ${id} for version ${importHistory.sourceVersion}`,
    );

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
  async addFailedEntry(
    importId: string,
    htsNumber: string,
    error: string,
  ): Promise<void> {
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
   * Get formula gate summary from staged validation metadata.
   */
  async getStageFormulaGate(importId: string): Promise<{
    formulaGatePassed: boolean;
    formulaCoverage: number | null;
    minCoverage: number | null;
    noteFormulaPolicy: string | null;
    totalRateFields: number | null;
    formulaResolvableCount: number | null;
    formulaUnresolvedCount: number | null;
    noteReferenceCount: number | null;
    noteResolvedCount: number | null;
    noteUnresolvedCount: number | null;
    validatedAt: string | null;
  }> {
    const importHistory = await this.findOne(importId);
    const metadata = importHistory.metadata || {};
    const formulaValidationSummary = metadata.formulaValidationSummary || {};
    const validationSummary = metadata.validationSummary || {};

    const formulaCoverage =
      typeof formulaValidationSummary.currentCoverage === 'number'
        ? formulaValidationSummary.currentCoverage
        : typeof validationSummary.formulaCoverage === 'number'
          ? validationSummary.formulaCoverage
          : null;

    const minCoverage =
      typeof formulaValidationSummary.minCoverage === 'number'
        ? formulaValidationSummary.minCoverage
        : null;

    const gateFlag =
      formulaValidationSummary.formulaGatePassed ??
      validationSummary.formulaGatePassed;
    const formulaGatePassed =
      typeof gateFlag === 'boolean'
        ? gateFlag
        : !((validationSummary.errorCount || 0) > 0);

    return {
      formulaGatePassed,
      formulaCoverage,
      minCoverage,
      noteFormulaPolicy: formulaValidationSummary.noteFormulaPolicy || null,
      totalRateFields:
        typeof formulaValidationSummary.totalRateFields === 'number'
          ? formulaValidationSummary.totalRateFields
          : null,
      formulaResolvableCount:
        typeof formulaValidationSummary.formulaResolvableCount === 'number'
          ? formulaValidationSummary.formulaResolvableCount
          : null,
      formulaUnresolvedCount:
        typeof formulaValidationSummary.formulaUnresolvedCount === 'number'
          ? formulaValidationSummary.formulaUnresolvedCount
          : null,
      noteReferenceCount:
        typeof formulaValidationSummary.noteReferenceCount === 'number'
          ? formulaValidationSummary.noteReferenceCount
          : null,
      noteResolvedCount:
        typeof formulaValidationSummary.noteResolvedCount === 'number'
          ? formulaValidationSummary.noteResolvedCount
          : null,
      noteUnresolvedCount:
        typeof formulaValidationSummary.noteUnresolvedCount === 'number'
          ? formulaValidationSummary.noteUnresolvedCount
          : null,
      validatedAt:
        formulaValidationSummary.validatedAt ||
        validationSummary.validatedAt ||
        null,
    };
  }

  /**
   * Get staging validation issues
   */
  async getStageValidationIssues(
    importId: string,
    query: StageValidationQueryDto,
  ): Promise<{
    data: HtsStageValidationIssueEntity[];
    meta: Record<string, any>;
  }> {
    await this.findOne(importId);

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;

    const qb = this.htsStageIssueRepo
      .createQueryBuilder('issue')
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

    const qb = this.htsStageDiffRepo
      .createQueryBuilder('diff')
      .where('diff.importId = :importId', { importId });

    if (query.diffType) {
      qb.andWhere('diff.diffType = :diffType', { diffType: query.diffType });
    }

    if (query.htsNumber) {
      qb.andWhere('diff.htsNumber = :htsNumber', {
        htsNumber: query.htsNumber,
      });
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
   * Preview deterministic Chapter 99 synthesis for staged entries before promotion.
   */
  async getStageChapter99Preview(
    importId: string,
    query: StageChapter99PreviewQueryDto,
  ): Promise<{
    data: Array<Record<string, any>>;
    meta: {
      total: number;
      offset: number;
      limit: number;
      statusCounts: Record<'LINKED' | 'UNRESOLVED' | 'NONE', number>;
    };
  }> {
    await this.findOne(importId);

    if (!this.htsChapter99FormulaService) {
      throw new BadRequestException(
        'Chapter 99 preview service is unavailable in current runtime context',
      );
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    const numberFilter = (query.htsNumber || '').trim().toUpperCase();

    const stagedEntries = await this.htsStageRepo.find({
      where: { importId },
      order: { htsNumber: 'ASC' },
    });

    const chapter99Lookup = new Map<string, Chapter99ReferenceInput>();
    const nonChapter99 = stagedEntries.filter(
      (entry) => entry.chapter !== '99',
    );

    for (const entry of stagedEntries) {
      if (entry.chapter !== '99') {
        continue;
      }
      chapter99Lookup.set(entry.htsNumber, {
        htsNumber: entry.htsNumber,
        description: entry.description,
        generalRate: entry.generalRate,
        general: entry.generalRate,
      });
    }

    const referencedCodes = new Set<string>();
    for (const entry of nonChapter99) {
      const links = this.resolveStageChapter99Links(entry);
      for (const link of links) {
        referencedCodes.add(link);
      }
    }

    if (referencedCodes.size > 0) {
      const missingCodes = Array.from(referencedCodes).filter(
        (code) => !chapter99Lookup.has(code),
      );

      if (missingCodes.length > 0) {
        const activeReferences = await this.htsRepo.find({
          where: {
            htsNumber: In(missingCodes),
            isActive: true,
          },
          order: { updatedAt: 'DESC' },
        });

        for (const reference of activeReferences) {
          if (!chapter99Lookup.has(reference.htsNumber)) {
            chapter99Lookup.set(reference.htsNumber, {
              htsNumber: reference.htsNumber,
              description: reference.description,
              generalRate: reference.generalRate || reference.general,
              general: reference.general,
              chapter99ApplicableCountries:
                reference.chapter99ApplicableCountries,
            });
          }
        }
      }
    }

    const statusCounts: Record<'LINKED' | 'UNRESOLVED' | 'NONE', number> = {
      LINKED: 0,
      UNRESOLVED: 0,
      NONE: 0,
    };
    const rows: Array<Record<string, any>> = [];

    for (const entry of nonChapter99) {
      if (
        numberFilter &&
        !entry.htsNumber.toUpperCase().includes(numberFilter)
      ) {
        continue;
      }

      const chapter99Links = this.resolveStageChapter99Links(entry);
      const preview = this.htsChapter99FormulaService.previewEntry(
        {
          htsNumber: entry.htsNumber,
          chapter: entry.chapter,
          description: entry.description,
          generalRate: entry.generalRate,
          rateFormula: null,
          footnotes: this.normalizeFootnotePayload(entry.rawItem?.footnotes),
          chapter99Links,
        },
        chapter99Lookup,
      );

      statusCounts[preview.status]++;

      if (query.status && preview.status !== query.status) {
        continue;
      }

      rows.push({
        htsNumber: entry.htsNumber,
        description: entry.description,
        chapter: entry.chapter,
        generalRate: entry.generalRate,
        status: preview.status,
        reason: preview.reason,
        chapter99Links: preview.chapter99Links,
        selectedChapter99: preview.selectedChapter99,
        chapter99ApplicableCountries: preview.chapter99ApplicableCountries,
        nonNtrApplicableCountries: preview.nonNtrApplicableCountries,
        previewFormula: {
          baseFormula: preview.baseFormula,
          adjustedFormula: preview.adjustedFormula,
          adjustedFormulaVariables: preview.adjustedFormulaVariables,
        },
      });
    }

    const total = rows.length;
    const data = rows.slice(offset, offset + limit);
    const dataHtsNumbers = Array.from(
      new Set(
        data
          .map((row) => String(row.htsNumber || '').trim())
          .filter((value) => value.length > 0),
      ),
    );

    const currentByHts = new Map<string, HtsEntity>();
    if (dataHtsNumbers.length > 0) {
      const activeRows = await this.htsRepo.find({
        where: {
          htsNumber: In(dataHtsNumbers),
          isActive: true,
        },
        order: { updatedAt: 'DESC' },
      });

      for (const row of activeRows) {
        if (!currentByHts.has(row.htsNumber)) {
          currentByHts.set(row.htsNumber, row);
        }
      }
    }

    const enrichedData = data.map((row) => {
      const current = currentByHts.get(row.htsNumber) || null;
      return {
        ...row,
        current: current
          ? {
              sourceVersion: current.sourceVersion,
              isActive: current.isActive,
              rateFormula: current.rateFormula,
              adjustedFormula: current.adjustedFormula,
              chapter99Links: current.chapter99Links,
              chapter99ApplicableCountries:
                current.chapter99ApplicableCountries,
            }
          : null,
      };
    });

    return {
      data: enrichedData,
      meta: {
        total,
        offset,
        limit,
        statusCounts,
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

    const qb = this.htsStageDiffRepo
      .createQueryBuilder('diff')
      .where('diff.importId = :importId', { importId });

    if (query.diffType) {
      qb.andWhere('diff.diffType = :diffType', { diffType: query.diffType });
    }

    if (query.htsNumber) {
      qb.andWhere('diff.htsNumber = :htsNumber', {
        htsNumber: query.htsNumber,
      });
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
      const changedFields = summary.changes
        ? Object.keys(summary.changes).join('|')
        : '';
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

  private resolveStageChapter99Links(
    stageEntry: HtsStageEntryEntity,
  ): string[] {
    const normalizedLinks = Array.isArray(stageEntry.normalized?.chapter99Links)
      ? (stageEntry.normalized?.chapter99Links as string[])
      : [];

    if (normalizedLinks.length > 0) {
      return this.normalizeChapter99Links(normalizedLinks);
    }

    const rawFootnotes = stageEntry.rawItem?.footnotes;
    const extracted =
      this.htsChapter99FormulaService?.extractChapter99LinksFromFootnotePayload(
        rawFootnotes,
      );
    return this.normalizeChapter99Links(extracted || []);
  }

  private normalizeChapter99Links(links: string[]): string[] {
    return Array.from(
      new Set(
        (links || [])
          .map((value) => (value || '').trim())
          .filter((value) => /^99\d{2}\.\d{2}\.\d{2}(?:\.\d{2})?$/.test(value)),
      ),
    ).sort();
  }

  private normalizeFootnotePayload(payload: unknown): string | null {
    if (!payload) return null;
    if (typeof payload === 'string') {
      const value = payload.trim();
      return value.length > 0 ? value : null;
    }
    if (Array.isArray(payload)) {
      const values = payload
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item.value === 'string') return item.value;
          return '';
        })
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      if (values.length > 0) {
        return values.join(' ');
      }

      return JSON.stringify(payload);
    }
    return JSON.stringify(payload);
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

    const formulaGate = await this.getStageFormulaGate(importId);
    const blockedReasons: string[] = [];
    if (errorCount > 0) {
      blockedReasons.push(`${errorCount} validation errors`);
    }
    if (!formulaGate.formulaGatePassed) {
      const coverageText =
        typeof formulaGate.formulaCoverage === 'number'
          ? `${(formulaGate.formulaCoverage * 100).toFixed(2)}%`
          : 'n/a';
      const minCoverageText =
        typeof formulaGate.minCoverage === 'number'
          ? `${(formulaGate.minCoverage * 100).toFixed(2)}%`
          : 'n/a';
      blockedReasons.push(
        `formula gate failed (coverage=${coverageText}, min=${minCoverageText})`,
      );
    }

    if (blockedReasons.length > 0 && !canOverrideValidation) {
      throw new BadRequestException(
        `Validation gate failed: ${blockedReasons.join('; ')}. Override permission required to promote.`,
      );
    }

    const metadata = importHistory.metadata || {};
    if (blockedReasons.length > 0 && canOverrideValidation) {
      metadata.validationOverride = true;
      metadata.validationOverrideBy = userId;
      metadata.validationOverrideAt = new Date().toISOString();
      metadata.validationOverrideReasons = blockedReasons;
      if (!formulaGate.formulaGatePassed) {
        metadata.formulaGateOverride = true;
      }
    }

    // Advance checkpoint to PROCESSING stage so job resumes at promotion
    const checkpoint = importHistory.checkpoint || {};
    checkpoint.stage = 'PROCESSING';
    checkpoint.processedBatches = 0;
    checkpoint.processedRecords = 0;

    await this.importHistoryRepo.update(importId, {
      metadata,
      checkpoint,
      status: 'IN_PROGRESS',
      errorMessage: null,
      errorStack: null,
    });

    const logMessage =
      blockedReasons.length > 0
        ? `Promotion requested by ${userId} with validation override (${blockedReasons.join('; ')})`
        : `Promotion requested by ${userId}`;

    await this.appendLog(importId, logMessage);

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
