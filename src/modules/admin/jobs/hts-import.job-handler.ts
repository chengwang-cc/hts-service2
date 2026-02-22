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

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets, In } from 'typeorm';
import {
  HtsImportHistoryEntity,
  HtsEntity,
  HtsProcessorService,
  S3StorageService,
  HtsStageEntryEntity,
  HtsStageValidationIssueEntity,
  HtsStageDiffEntity,
  HtsExtraTaxEntity,
  HtsFormulaUpdateEntity,
  HtsFormulaGenerationService,
  FormulaGenerationService,
  HtsChapter99FormulaService,
  HtsEmbeddingGenerationService,
} from '@hts/core';
import { NoteResolutionService } from '@hts/knowledgebase';
import { HtsImportService } from '../services/hts-import.service';
import { LookupAccuracySmokeService } from '../services/lookup-accuracy-smoke.service';
import axios from 'axios';
import { Readable } from 'stream';
import { createHash } from 'crypto';

interface ImportCheckpoint {
  stage:
    | 'DOWNLOADING'
    | 'DOWNLOADED'
    | 'STAGING'
    | 'VALIDATING'
    | 'DIFFING'
    | 'PROCESSING'
    | 'COMPLETED';
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
  private readonly MIN_STAGE_FORMULA_COVERAGE = Math.min(
    1,
    Math.max(0, parseFloat(process.env.HTS_MIN_FORMULA_COVERAGE || '0.995')),
  );
  private readonly ALLOW_UNRESOLVED_NOTE_FORMULAS =
    process.env.HTS_ALLOW_UNRESOLVED_NOTE_FORMULAS === 'true';

  constructor(
    @InjectRepository(HtsImportHistoryEntity)
    private importHistoryRepo: Repository<HtsImportHistoryEntity>,
    @InjectRepository(HtsEntity)
    private htsRepo: Repository<HtsEntity>,
    @InjectRepository(HtsStageEntryEntity)
    private htsStageRepo: Repository<HtsStageEntryEntity>,
    @InjectRepository(HtsStageValidationIssueEntity)
    private htsStageIssueRepo: Repository<HtsStageValidationIssueEntity>,
    @InjectRepository(HtsStageDiffEntity)
    private htsStageDiffRepo: Repository<HtsStageDiffEntity>,
    @InjectRepository(HtsExtraTaxEntity)
    private htsExtraTaxRepo: Repository<HtsExtraTaxEntity>,
    @InjectRepository(HtsFormulaUpdateEntity)
    private htsFormulaUpdateRepo: Repository<HtsFormulaUpdateEntity>,
    private htsProcessor: HtsProcessorService,
    private htsImportService: HtsImportService,
    private s3Storage: S3StorageService,
    private htsFormulaGenerationService: HtsFormulaGenerationService,
    private htsChapter99FormulaService: HtsChapter99FormulaService,
    private formulaGenerationService: FormulaGenerationService,
    @Optional()
    private htsEmbeddingGenerationService?: HtsEmbeddingGenerationService,
    @Optional() private noteResolutionService?: NoteResolutionService,
    @Optional() private lookupAccuracySmokeService?: LookupAccuracySmokeService,
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
      const checkpoint: ImportCheckpoint =
        (importHistory.checkpoint as ImportCheckpoint) || {
          stage: 'DOWNLOADING',
        };

      this.logger.log(
        `Import ${importId}: Resuming from stage: ${checkpoint.stage}` +
          (checkpoint.processedBatches
            ? ` (${checkpoint.processedBatches} batches completed)`
            : ''),
      );

      // ====== STAGE 1: DOWNLOAD TO S3 ======
      if (checkpoint.stage === 'DOWNLOADING') {
        await this.downloadToS3(importHistory, checkpoint);

        // Save checkpoint after successful download
        checkpoint.stage = 'DOWNLOADED';
        await this.saveCheckpoint(importId, checkpoint);
        await this.htsImportService.appendLog(
          importId,
          '✓ Download stage completed',
        );
      }

      // ====== STAGE 2: PROCESS FROM S3 ======
      if (checkpoint.stage === 'DOWNLOADED') {
        checkpoint.stage = 'STAGING';
        checkpoint.processedBatches = 0;
        checkpoint.processedRecords = 0;
        await this.saveCheckpoint(importId, checkpoint);
        await this.htsImportService.appendLog(
          importId,
          'Starting staging stage...',
        );
      }

      if (checkpoint.stage === 'STAGING') {
        await this.stageFromS3(importHistory, checkpoint);

        checkpoint.stage = 'VALIDATING';
        checkpoint.processedBatches = 0;
        checkpoint.processedRecords = 0;
        await this.saveCheckpoint(importId, checkpoint);
      }

      if (checkpoint.stage === 'VALIDATING') {
        await this.validateStagedEntries(importHistory);

        checkpoint.stage = 'DIFFING';
        await this.saveCheckpoint(importId, checkpoint);
      }

      if (checkpoint.stage === 'DIFFING') {
        await this.diffStagedEntries(importHistory);

        // After diffing, check validation and stop for manual promotion
        const validationSummary = await this.getValidationSummary(
          importHistory.id,
        );
        const formulaCoverageText =
          typeof validationSummary.formulaCoverage === 'number'
            ? `${(validationSummary.formulaCoverage * 100).toFixed(2)}%`
            : 'n/a';

        if (
          validationSummary.errorCount > 0 ||
          !validationSummary.formulaGatePassed
        ) {
          // Has validation errors - requires admin review
          await this.importHistoryRepo.update(importHistory.id, {
            status: 'REQUIRES_REVIEW',
          });
          const reviewReasons: string[] = [];
          if (validationSummary.errorCount > 0) {
            reviewReasons.push(
              `${validationSummary.errorCount} validation errors`,
            );
          }
          if (!validationSummary.formulaGatePassed) {
            reviewReasons.push(
              `formula gate failed (coverage=${formulaCoverageText}, min=${(this.MIN_STAGE_FORMULA_COVERAGE * 100).toFixed(2)}%)`,
            );
          }
          await this.htsImportService.appendLog(
            importHistory.id,
            `✓ Staging complete. Requires review before promotion: ${reviewReasons.join('; ')}.`,
          );
          this.logger.log(
            `Import ${importHistory.id} staged with review blockers: ${reviewReasons.join('; ')}`,
          );
          // Don't advance checkpoint - leave at DIFFING stage
          return;
        } else {
          // No validation errors - ready for promotion but requires manual action
          await this.importHistoryRepo.update(importHistory.id, {
            status: 'STAGED_READY',
          });
          await this.htsImportService.appendLog(
            importHistory.id,
            `✓ Staging complete. Validation clean and formula gate passed (coverage=${formulaCoverageText}). Ready for promotion.`,
          );
          this.logger.log(
            `Import ${importHistory.id} staged successfully - ready for manual promotion`,
          );
          // Don't advance checkpoint - leave at DIFFING stage
          return;
        }
      }

      // PROCESSING stage - only reached when admin explicitly calls /promote
      if (checkpoint.stage === 'PROCESSING') {
        const validationSummary = await this.getValidationSummary(
          importHistory.id,
        );
        const refreshedImport = await this.importHistoryRepo.findOne({
          where: { id: importHistory.id },
        });

        const validationOverride =
          (refreshedImport?.metadata as any)?.validationOverride === true;

        if (
          (validationSummary.errorCount > 0 ||
            !validationSummary.formulaGatePassed) &&
          !validationOverride
        ) {
          await this.importHistoryRepo.update(importHistory.id, {
            status: 'REQUIRES_REVIEW',
          });
          const blockedReasons: string[] = [];
          if (validationSummary.errorCount > 0) {
            blockedReasons.push(
              `${validationSummary.errorCount} validation errors`,
            );
          }
          if (!validationSummary.formulaGatePassed) {
            const formulaCoverageText =
              typeof validationSummary.formulaCoverage === 'number'
                ? `${(validationSummary.formulaCoverage * 100).toFixed(2)}%`
                : 'n/a';
            blockedReasons.push(
              `formula gate failed (coverage=${formulaCoverageText}, min=${(this.MIN_STAGE_FORMULA_COVERAGE * 100).toFixed(2)}%)`,
            );
          }
          await this.htsImportService.appendLog(
            importHistory.id,
            `✗ Promotion blocked: ${blockedReasons.join('; ')}. Override permission required.`,
          );
          this.logger.warn(
            `Import ${importHistory.id} promotion blocked: ${blockedReasons.join('; ')}`,
          );
          return;
        }

        await this.htsImportService.appendLog(
          importId,
          `Starting promotion to production HTS...${validationOverride ? ' (validation override enabled)' : ''}`,
        );
        await this.processFromStage(importHistory, checkpoint);

        // Mark as completed
        checkpoint.stage = 'COMPLETED';
        await this.saveCheckpoint(importId, checkpoint);
      }

      const finalizeResult =
        await this.htsImportService.finalizeSuccessfulImport(importHistory);
      await this.htsImportService.appendLog(
        importId,
        `✓ Activated version ${importHistory.sourceVersion}; ` +
          `deactivated ${finalizeResult.deactivatedCount} old entries`,
      );

      try {
        await this.runPostPromotionEnrichment(importHistory);
      } catch (enrichmentError: any) {
        this.logger.warn(
          `Post-promotion enrichment failed for import ${importHistory.id}: ${enrichmentError.message}`,
        );
        await this.htsImportService.appendLog(
          importId,
          `⚠ Post-promotion enrichment failed: ${enrichmentError.message}`,
        );
      }

      // Final status update
      await this.htsImportService.updateStatus(importId, 'COMPLETED');
      await this.htsImportService.appendLog(
        importId,
        `✓ Import completed successfully (${checkpoint.processedRecords || 0} records processed)`,
      );

      this.logger.log(`Import job ${importId} completed successfully`);
    } catch (error) {
      this.logger.error(
        `Import job ${importId} failed: ${error.message}`,
        error.stack,
      );

      // Mark as failed (pg-boss will retry automatically)
      await this.htsImportService.updateStatus(
        importId,
        'FAILED',
        error.message,
        error.stack,
      );
      await this.htsImportService.appendLog(
        importId,
        `✗ Import failed: ${error.message}`,
      );

      throw error; // Let pg-boss handle retry
    }
  }

  private async runPostPromotionEnrichment(
    importHistory: HtsImportHistoryEntity,
  ): Promise<void> {
    const sourceVersion = importHistory.sourceVersion;

    // Build hierarchy fields (parentHtsNumber, parentHtses, fullDescription, searchVector)
    // The staging pipeline does not populate these, so we rebuild them after promotion.
    await this.htsImportService.appendLog(
      importHistory.id,
      'Building HTS hierarchy descriptions for promoted entries...',
    );
    await this.buildHierarchyDescriptions(importHistory.id, sourceVersion);
    await this.htsImportService.appendLog(
      importHistory.id,
      '✓ HTS hierarchy descriptions built.',
    );

    await this.htsImportService.appendLog(
      importHistory.id,
      'Running post-promotion formula generation...',
    );

    const formulaResult =
      await this.htsFormulaGenerationService.generateMissingFormulas({
        sourceVersion,
        activeOnly: true,
        includeAdjusted: true,
        batchSize: 500,
      });

    await this.htsImportService.appendLog(
      importHistory.id,
      `✓ Formula generation complete: general=${formulaResult.generalUpdated}, other=${formulaResult.otherUpdated}, adjusted=${formulaResult.adjustedUpdated}, unresolved=${formulaResult.unresolvedGeneral + formulaResult.unresolvedOther + formulaResult.unresolvedAdjusted}`,
    );

    if (!this.noteResolutionService) {
      await this.htsImportService.appendLog(
        importHistory.id,
        'Knowledgebase note resolution is not available; skipped note formula enrichment.',
      );
    } else {
      const noteResolutionResult = await this.enrichFormulasFromNotes(
        importHistory,
        sourceVersion,
      );

      await this.htsImportService.appendLog(
        importHistory.id,
        `✓ Note enrichment complete: resolved=${noteResolutionResult.resolved}, unresolved=${noteResolutionResult.unresolved}, failed=${noteResolutionResult.failed}`,
      );
    }

    const overrideCarryoverResult = await this.applyCarryoverFormulaOverrides(
      importHistory,
      sourceVersion,
    );

    await this.htsImportService.appendLog(
      importHistory.id,
      `✓ Carryover formula overrides applied: entriesPatched=${overrideCarryoverResult.entriesPatched}, overridesApplied=${overrideCarryoverResult.overridesApplied}, skippedCountrySpecific=${overrideCarryoverResult.skippedCountrySpecific}`,
    );

    await this.htsImportService.appendLog(
      importHistory.id,
      'Running deterministic Chapter 99 synthesis...',
    );

    const chapter99Result =
      await this.htsChapter99FormulaService.synthesizeAdjustedFormulas({
        sourceVersion,
        activeOnly: true,
        batchSize: 500,
      });

    await this.htsImportService.appendLog(
      importHistory.id,
      `✓ Chapter 99 synthesis complete: processed=${chapter99Result.processed}, linked=${chapter99Result.linked}, updated=${chapter99Result.updated}, unresolved=${chapter99Result.unresolved}, nonNtrDefaultsApplied=${chapter99Result.nonNtrDefaultsApplied}`,
    );

    if (!this.htsEmbeddingGenerationService) {
      await this.htsImportService.appendLog(
        importHistory.id,
        'Embedding generation service unavailable; skipped HTS embedding refresh.',
      );
    } else {
      await this.htsImportService.appendLog(
        importHistory.id,
        'Refreshing HTS embeddings for promoted source version...',
      );
      const embeddingResult =
        await this.htsEmbeddingGenerationService.generateEmbeddingsForSourceVersion(
          sourceVersion,
          200,
        );
      await this.htsImportService.appendLog(
        importHistory.id,
        `✓ HTS embedding refresh complete: total=${embeddingResult.total}, generated=${embeddingResult.generated}, failed=${embeddingResult.failed}`,
      );
    }

    await this.runLookupAccuracySmoke(importHistory, sourceVersion);
  }

  private async runLookupAccuracySmoke(
    importHistory: HtsImportHistoryEntity,
    sourceVersion: string,
  ): Promise<void> {
    const enabled =
      (process.env.HTS_LOOKUP_SMOKE_ON_PROMOTION ?? 'true') === 'true';

    if (!enabled) {
      await this.htsImportService.appendLog(
        importHistory.id,
        'Lookup smoke evaluation disabled by HTS_LOOKUP_SMOKE_ON_PROMOTION=false.',
      );
      return;
    }

    if (!this.lookupAccuracySmokeService) {
      await this.htsImportService.appendLog(
        importHistory.id,
        'Lookup smoke evaluation service unavailable; skipped post-promotion evaluation.',
      );
      return;
    }

    await this.htsImportService.appendLog(
      importHistory.id,
      'Running lookup/search/classify smoke evaluation set...',
    );

    try {
      const summary = await this.lookupAccuracySmokeService.runSmokeEvaluation({
        sourceVersion,
      });

      const auto = summary.endpointMetrics.autocomplete;
      const search = summary.endpointMetrics.search;
      const classify = summary.classificationTop1;

      const autoHit10 =
        auto.evaluated > 0
          ? ((auto.exactTop10 / auto.evaluated) * 100).toFixed(2)
          : 'n/a';
      const searchHit10 =
        search.evaluated > 0
          ? ((search.exactTop10 / search.evaluated) * 100).toFixed(2)
          : 'n/a';
      const classifyTop1 =
        classify.evaluated > 0
          ? ((classify.exactTop1 / classify.evaluated) * 100).toFixed(2)
          : 'n/a';

      await this.htsImportService.appendLog(
        importHistory.id,
        `✓ Lookup smoke evaluation complete: dataset=${summary.datasetPath}, loaded=${summary.totalRecordsLoaded}, sampled=${summary.sampledRecords}, autocomplete_hit@10=${autoHit10}%, search_hit@10=${searchHit10}%, classify_top1=${classifyTop1}%`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Lookup smoke evaluation failed: ${message}`);
      await this.htsImportService.appendLog(
        importHistory.id,
        `⚠ Lookup smoke evaluation failed: ${message}`,
      );
    }
  }

  /**
   * Rebuild parentHtsNumber, parentHtses, fullDescription, and searchVector
   * for all entries of the promoted source version.
   *
   * HTS codes follow a strict prefix hierarchy (4 / 7 / 10 / 13 chars),
   * so we use exact substring lookups — O(n log n) — instead of LIKE joins.
   */
  private async buildHierarchyDescriptions(
    importId: string,
    sourceVersion: string,
  ): Promise<void> {
    const em = this.htsRepo.manager;

    // 1. parent_hts_number
    await em.query(`
      UPDATE hts child
      SET parent_hts_number = COALESCE(
        CASE WHEN length(child.hts_number) = 13 THEN (
          SELECT p.hts_number FROM hts p
          WHERE p.hts_number = substring(child.hts_number, 1, 10)
            AND p.source_version = $1 AND p.is_active = true LIMIT 1
        ) END,
        CASE WHEN length(child.hts_number) >= 10 THEN (
          SELECT p.hts_number FROM hts p
          WHERE p.hts_number = substring(child.hts_number, 1, 7)
            AND p.source_version = $1 AND p.is_active = true LIMIT 1
        ) END,
        CASE WHEN length(child.hts_number) >= 7 THEN (
          SELECT p.hts_number FROM hts p
          WHERE p.hts_number = substring(child.hts_number, 1, 4)
            AND p.source_version = $1 AND p.is_active = true LIMIT 1
        ) END
      )
      WHERE child.source_version = $1
        AND child.is_active = true
        AND length(child.hts_number) > 4
    `, [sourceVersion]);

    // 2. parent_htses
    await em.query(`
      UPDATE hts child
      SET parent_htses = (
        SELECT jsonb_agg(anc ORDER BY ord)
        FROM (
          SELECT 1 AS ord, p1.hts_number AS anc FROM hts p1
          WHERE p1.hts_number = substring(child.hts_number, 1, 4)
            AND p1.source_version = $1 AND p1.is_active = true
            AND length(child.hts_number) > 4
          UNION ALL
          SELECT 2, p2.hts_number FROM hts p2
          WHERE p2.hts_number = substring(child.hts_number, 1, 7)
            AND p2.source_version = $1 AND p2.is_active = true
            AND length(child.hts_number) > 7
          UNION ALL
          SELECT 3, p3.hts_number FROM hts p3
          WHERE p3.hts_number = substring(child.hts_number, 1, 10)
            AND p3.source_version = $1 AND p3.is_active = true
            AND length(child.hts_number) > 10
        ) ancestors
      )
      WHERE child.source_version = $1
        AND child.is_active = true
        AND length(child.hts_number) > 4
    `, [sourceVersion]);

    // 3. full_description (ancestor descs + own desc)
    await em.query(`
      UPDATE hts child
      SET full_description = (
        SELECT jsonb_agg(d ORDER BY ord)
        FROM (
          SELECT 1 AS ord, p1.description AS d FROM hts p1
          WHERE p1.hts_number = substring(child.hts_number, 1, 4)
            AND p1.source_version = $1 AND p1.is_active = true
            AND length(child.hts_number) > 4
          UNION ALL
          SELECT 2, p2.description FROM hts p2
          WHERE p2.hts_number = substring(child.hts_number, 1, 7)
            AND p2.source_version = $1 AND p2.is_active = true
            AND length(child.hts_number) > 7
          UNION ALL
          SELECT 3, p3.description FROM hts p3
          WHERE p3.hts_number = substring(child.hts_number, 1, 10)
            AND p3.source_version = $1 AND p3.is_active = true
            AND length(child.hts_number) > 10
          UNION ALL
          SELECT 4, child.description
        ) desc_chain
      )
      WHERE child.source_version = $1 AND child.is_active = true
    `, [sourceVersion]);

    // For top-level headings (4-char), full_description = own description only
    await em.query(`
      UPDATE hts
      SET full_description = jsonb_build_array(description)
      WHERE source_version = $1 AND is_active = true AND length(hts_number) = 4
        AND (full_description IS NULL OR jsonb_array_length(COALESCE(full_description, '[]'::jsonb)) = 0)
    `, [sourceVersion]);

    // 4. Rebuild search_vector to include ancestor descriptions
    await em.query(`
      UPDATE hts
      SET search_vector = to_tsvector('english',
        COALESCE(hts_number, '') || ' ' ||
        COALESCE(description, '') || ' ' ||
        COALESCE((
          SELECT string_agg(elem, ' ')
          FROM jsonb_array_elements_text(COALESCE(full_description, '[]'::jsonb)) AS elem
        ), '')
      )
      WHERE source_version = $1 AND is_active = true
    `, [sourceVersion]);
  }

  private async applyCarryoverFormulaOverrides(
    importHistory: HtsImportHistoryEntity,
    sourceVersion: string,
  ): Promise<{
    entriesPatched: number;
    overridesApplied: number;
    skippedCountrySpecific: number;
  }> {
    const activeEntries = await this.htsRepo.find({
      where: {
        sourceVersion,
        isActive: true,
      },
    });

    if (activeEntries.length === 0) {
      return {
        entriesPatched: 0,
        overridesApplied: 0,
        skippedCountrySpecific: 0,
      };
    }

    const overrides = await this.htsFormulaUpdateRepo
      .createQueryBuilder('hfu')
      .where('hfu.active = true')
      .andWhere(
        '(hfu.updateVersion = :sourceVersion OR hfu.carryover = true)',
        { sourceVersion },
      )
      .orderBy('hfu.updatedAt', 'DESC')
      .getMany();

    if (overrides.length === 0) {
      return {
        entriesPatched: 0,
        overridesApplied: 0,
        skippedCountrySpecific: 0,
      };
    }

    const entryMap = new Map(
      activeEntries.map((entry) => [entry.htsNumber, entry]),
    );
    const appliedKeys = new Set<string>();
    const modifiedEntryIds = new Set<string>();
    let overridesApplied = 0;
    let skippedCountrySpecific = 0;

    for (const update of overrides) {
      const key = `${update.htsNumber}|${update.countryCode}|${update.formulaType}`;
      if (appliedKeys.has(key)) {
        continue;
      }
      appliedKeys.add(key);

      const entry = entryMap.get(update.htsNumber);
      if (!entry) {
        continue;
      }

      const formulaType = (update.formulaType || '').toUpperCase();
      const countryCode = (update.countryCode || 'ALL').toUpperCase();
      const isCountrySpecific = countryCode !== 'ALL';
      let updated = false;

      if (formulaType === 'GENERAL') {
        if (isCountrySpecific) {
          skippedCountrySpecific += 1;
          continue;
        }
        if (!entry.generalRate || entry.generalRate.trim() === '') {
          continue;
        }
        entry.rateFormula = update.formula;
        if (update.formulaVariables !== undefined) {
          entry.rateVariables = update.formulaVariables ?? null;
        }
        updated = true;
      } else if (formulaType === 'OTHER') {
        if (isCountrySpecific) {
          skippedCountrySpecific += 1;
          continue;
        }
        if (!entry.otherRate || entry.otherRate.trim() === '') {
          continue;
        }
        entry.otherRateFormula = update.formula;
        if (update.formulaVariables !== undefined) {
          entry.otherRateVariables = update.formulaVariables ?? null;
        }
        updated = true;
      } else if (formulaType === 'ADJUSTED') {
        entry.adjustedFormula = update.formula;
        if (update.formulaVariables !== undefined) {
          entry.adjustedFormulaVariables = update.formulaVariables ?? null;
        }
        if (isCountrySpecific) {
          const countries = new Set(
            (entry.chapter99ApplicableCountries || []).map((code) =>
              code.toUpperCase(),
            ),
          );
          countries.add(countryCode);
          entry.chapter99ApplicableCountries = Array.from(countries);
        }
        updated = true;
      } else if (formulaType === 'OTHER_CHAPTER99') {
        const countries = new Set(
          (entry.otherChapter99Detail?.countries || []).map((code) =>
            code.toUpperCase(),
          ),
        );
        if (isCountrySpecific) {
          countries.add(countryCode);
        }
        entry.otherChapter99Detail = {
          ...(entry.otherChapter99Detail || {}),
          formula: update.formula,
          variables:
            update.formulaVariables ||
            entry.otherChapter99Detail?.variables ||
            undefined,
          countries: Array.from(countries),
        };
        updated = true;
      }

      if (updated) {
        entry.confirmed = true;
        entry.requiredReview = false;
        entry.updateFormulaComment = `Carryover override applied (${formulaType}) from hts_formula_updates`;
        entry.metadata = {
          ...(entry.metadata || {}),
          carryoverOverrideAppliedAt: new Date().toISOString(),
          carryoverOverrideFormulaType: formulaType,
          carryoverOverrideCountry: countryCode,
        };
        overridesApplied += 1;
        modifiedEntryIds.add(entry.id);
      }
    }

    const changedEntries = activeEntries.filter((entry) =>
      modifiedEntryIds.has(entry.id),
    );
    if (changedEntries.length > 0) {
      await this.htsRepo.save(changedEntries);
    }

    return {
      entriesPatched: changedEntries.length,
      overridesApplied,
      skippedCountrySpecific,
    };
  }

  private async enrichFormulasFromNotes(
    importHistory: HtsImportHistoryEntity,
    sourceVersion: string,
  ): Promise<{ resolved: number; unresolved: number; failed: number }> {
    const candidates = await this.htsRepo
      .createQueryBuilder('hts')
      .where('hts.sourceVersion = :sourceVersion', { sourceVersion })
      .andWhere('hts.isActive = :isActive', { isActive: true })
      .andWhere(
        new Brackets((qb) => {
          qb.where(
            "(hts.rateFormula IS NULL AND hts.generalRate IS NOT NULL AND hts.generalRate ~* 'note')",
          ).orWhere(
            "(hts.otherRateFormula IS NULL AND hts.otherRate IS NOT NULL AND hts.otherRate ~* 'note')",
          );
        }),
      )
      .select([
        'hts.id',
        'hts.htsNumber',
        'hts.sourceVersion',
        'hts.generalRate',
        'hts.otherRate',
        'hts.rateFormula',
        'hts.otherRateFormula',
        'hts.rateVariables',
        'hts.otherRateVariables',
        'hts.isFormulaGenerated',
        'hts.isOtherFormulaGenerated',
        'hts.metadata',
      ])
      .getMany();

    if (candidates.length === 0) {
      return { resolved: 0, unresolved: 0, failed: 0 };
    }

    let resolved = 0;
    let unresolved = 0;
    let failed = 0;
    const year = this.extractYear(sourceVersion);

    for (const entry of candidates) {
      try {
        let updated = false;
        const metadata = { ...(entry.metadata || {}) };

        if (
          !entry.rateFormula &&
          entry.generalRate &&
          /note/i.test(entry.generalRate)
        ) {
          const resolvedGeneral =
            await this.noteResolutionService!.resolveNoteReference(
              entry.htsNumber,
              entry.generalRate,
              'general',
              year,
            );

          if (resolvedGeneral?.formula) {
            entry.rateFormula = resolvedGeneral.formula;
            entry.rateVariables = resolvedGeneral.variables || null;
            entry.isFormulaGenerated = true;
            metadata.noteResolvedGeneral = true;
            metadata.noteResolvedGeneralAt = new Date().toISOString();
            updated = true;
            resolved++;
          } else {
            unresolved++;
          }
        }

        if (
          !entry.otherRateFormula &&
          entry.otherRate &&
          /note/i.test(entry.otherRate)
        ) {
          const resolvedOther =
            await this.noteResolutionService!.resolveNoteReference(
              entry.htsNumber,
              entry.otherRate,
              'other',
              year,
            );

          if (resolvedOther?.formula) {
            entry.otherRateFormula = resolvedOther.formula;
            entry.otherRateVariables = resolvedOther.variables || null;
            entry.isOtherFormulaGenerated = true;
            metadata.noteResolvedOther = true;
            metadata.noteResolvedOtherAt = new Date().toISOString();
            updated = true;
            resolved++;
          } else {
            unresolved++;
          }
        }

        if (updated) {
          entry.metadata = metadata;
          await this.htsRepo.save(entry);
        }
      } catch (error) {
        failed++;
        this.logger.warn(
          `Failed to enrich formula from notes for ${entry.htsNumber}: ${error.message}`,
        );
        await this.htsImportService.appendLog(
          importHistory.id,
          `Note enrichment failed for ${entry.htsNumber}: ${error.message}`,
        );
      }
    }

    return { resolved, unresolved, failed };
  }

  private extractYear(sourceVersion: string | null): number | undefined {
    if (!sourceVersion) {
      return undefined;
    }
    const match = sourceVersion.match(/(19|20)\d{2}/);
    return match ? parseInt(match[0], 10) : undefined;
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
        `Using existing S3 file: ${s3Key} (${(metadata.size / 1024 / 1024).toFixed(2)} MB)`,
      );
      return;
    }

    // Download from USITC with streaming
    await this.htsImportService.updateStatus(importHistory.id, 'IN_PROGRESS');
    await this.htsImportService.appendLog(
      importHistory.id,
      `Downloading from USITC: ${importHistory.sourceUrl}`,
    );

    this.logger.log(
      `Downloading ${importHistory.sourceVersion} from ${importHistory.sourceUrl}`,
    );

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
        `SHA-256: ${uploadResult.sha256?.substring(0, 12)}...`,
    );

    this.logger.log(
      `Downloaded ${importHistory.sourceVersion} to S3: ${s3Key}`,
    );
  }

  /**
   * STAGE 2: Load raw data from S3
   */
  private async loadSourceData(s3Bucket: string, s3Key: string): Promise<any> {
    const stream = await this.s3Storage.downloadStream(s3Bucket, s3Key);
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
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
      `Processing HTS entries from S3...`,
    );

    const data = await this.loadSourceData(s3Bucket, s3Key);

    // Debug logging to inspect parsed data structure
    this.logger.log(
      `🔍 Parsed data type: ${Array.isArray(data) ? 'Array' : typeof data}`,
    );
    if (Array.isArray(data)) {
      this.logger.log(`🔍 Array length: ${data.length}`);
      if (data.length > 0) {
        this.logger.log(
          `🔍 First entry sample: ${JSON.stringify(data[0]).substring(0, 200)}...`,
        );
      }
    } else if (typeof data === 'object' && data !== null) {
      const keys = Object.keys(data);
      this.logger.log(
        `🔍 Object keys (first 10): ${keys.slice(0, 10).join(', ')}`,
      );
      this.logger.log(`🔍 Has 'chapters' key: ${keys.includes('chapters')}`);
    }

    // Count total entries
    const totalEntries = this.countEntries(data);
    await this.htsImportService.updateCounters(importHistory.id, {
      totalEntries,
    });
    await this.htsImportService.appendLog(
      importHistory.id,
      `Total entries to process: ${totalEntries.toLocaleString()}`,
    );

    // Initialize counters
    let processedCount = checkpoint.processedRecords || 0;
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let batchNumber = checkpoint.processedBatches || 0;

    // Handle both flat array and chapter-based formats
    const chapters: Array<[string, any[]]> = Array.isArray(data)
      ? [['all', data]] // Flat array: treat as single chapter
      : Object.entries(data.chapters || data); // Chapter-based format

    const totalBatches = Math.ceil(totalEntries / this.BATCH_SIZE);

    checkpoint.totalBatches = totalBatches;

    this.logger.log(
      `Processing ${totalEntries} entries in ${totalBatches} batches of ${this.BATCH_SIZE}`,
    );

    // Process chapters
    for (const [chapterKey, items] of chapters) {
      // Skip if already processed (resume scenario)
      if (
        checkpoint.lastProcessedChapter &&
        chapterKey < checkpoint.lastProcessedChapter
      ) {
        this.logger.log(`Skipping already processed chapter: ${chapterKey}`);
        continue;
      }

      if (!Array.isArray(items)) continue;

      const chapterStartIndex =
        checkpoint.lastProcessedChapter === chapterKey
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
                  this.logger.error(
                    `Failed to process entry: ${error.message}`,
                  );
                  throw error; // Rollback entire batch
                }
              }

              return { batchImported, batchUpdated, batchSkipped };
            },
          );

          importedCount += batchResult.batchImported;
          updatedCount += batchResult.batchUpdated;
          skippedCount += batchResult.batchSkipped;
          processedCount += batch.length;
          batchNumber++;

          const batchDuration = Date.now() - batchStartTime;
          const percentComplete = Math.round(
            (processedCount / totalEntries) * 100,
          );

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
              `[+${batchResult.batchImported} ~${batchResult.batchUpdated} =${batchResult.batchSkipped}]`,
          );

          // Log progress every 10 batches
          if (batchNumber % 10 === 0) {
            await this.htsImportService.appendLog(
              importHistory.id,
              `Progress: ${processedCount.toLocaleString()}/${totalEntries.toLocaleString()} ` +
                `(${percentComplete}%) - Batch ${batchNumber}/${totalBatches}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Batch ${batchNumber} failed: ${error.message}`,
            error.stack,
          );
          failedCount += batch.length;

          // Log failed batch (but continue processing)
          await this.htsImportService.addFailedEntry(
            importHistory.id,
            `Batch ${batchNumber} (Chapter ${chapterKey})`,
            error.message,
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
        `${failedCount.toLocaleString()} failed`,
    );

    this.logger.log(
      `Import ${importHistory.id} processing complete: ` +
        `${importedCount} imported, ${updatedCount} updated, ${failedCount} failed`,
    );
  }

  /**
   * STAGE 3: Promote staged data into production HTS
   * - Uses staged entries as source of truth
   * - Processes in batches with checkpoints
   */
  private async processFromStage(
    importHistory: HtsImportHistoryEntity,
    checkpoint: ImportCheckpoint,
  ): Promise<void> {
    const totalEntries = await this.htsStageRepo.count({
      where: { importId: importHistory.id },
    });

    if (totalEntries === 0) {
      throw new Error('No staged entries found for import');
    }

    await this.htsImportService.appendLog(
      importHistory.id,
      `Processing HTS entries from staging (${totalEntries.toLocaleString()} records)...`,
    );

    await this.htsImportService.updateCounters(importHistory.id, {
      totalEntries,
    });

    let processedCount = checkpoint.processedRecords || 0;
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let batchNumber = checkpoint.processedBatches || 0;

    const totalBatches = Math.ceil(totalEntries / this.BATCH_SIZE);
    checkpoint.totalBatches = totalBatches;

    for (
      let offset = processedCount;
      offset < totalEntries;
      offset += this.BATCH_SIZE
    ) {
      const batch = await this.htsStageRepo.find({
        where: { importId: importHistory.id },
        order: { htsNumber: 'ASC' },
        take: this.BATCH_SIZE,
        skip: offset,
      });

      if (batch.length === 0) break;

      const batchStartTime = Date.now();

      try {
        const batchResult = await this.htsRepo.manager.transaction(
          async (transactionalEntityManager) => {
            let batchImported = 0;
            let batchUpdated = 0;
            let batchSkipped = 0;

            for (const staged of batch) {
              try {
                const result = await this.processStagedEntry(
                  staged,
                  importHistory.sourceVersion,
                  transactionalEntityManager,
                );

                if (result === 'CREATED') batchImported++;
                else if (result === 'UPDATED') batchUpdated++;
                else if (result === 'SKIPPED') batchSkipped++;
              } catch (error) {
                this.logger.error(
                  `Failed to process staged entry: ${error.message}`,
                );
                throw error;
              }
            }

            return { batchImported, batchUpdated, batchSkipped };
          },
        );

        importedCount += batchResult.batchImported;
        updatedCount += batchResult.batchUpdated;
        skippedCount += batchResult.batchSkipped;
        processedCount += batch.length;
        batchNumber++;

        const batchDuration = Date.now() - batchStartTime;
        const percentComplete = Math.round(
          (processedCount / totalEntries) * 100,
        );

        checkpoint.processedBatches = batchNumber;
        checkpoint.processedRecords = processedCount;
        await this.saveCheckpoint(importHistory.id, checkpoint);

        await this.htsImportService.updateCounters(importHistory.id, {
          importedEntries: importedCount,
          updatedEntries: updatedCount,
          skippedEntries: skippedCount,
        });

        this.logger.log(
          `Stage batch ${batchNumber}/${totalBatches} completed in ${batchDuration}ms: ` +
            `${processedCount.toLocaleString()}/${totalEntries.toLocaleString()} (${percentComplete}%) ` +
            `[+${batchResult.batchImported} ~${batchResult.batchUpdated} =${batchResult.batchSkipped}]`,
        );

        if (batchNumber % 10 === 0) {
          await this.htsImportService.appendLog(
            importHistory.id,
            `Processing progress: ${processedCount.toLocaleString()}/${totalEntries.toLocaleString()} ` +
              `(${percentComplete}%) - Batch ${batchNumber}/${totalBatches}`,
          );
        }
      } catch (error) {
        const failedBatchNumber = batchNumber + 1;
        this.logger.error(
          `Stage batch ${failedBatchNumber} failed: ${error.message}`,
          error.stack,
        );

        await this.htsImportService.addFailedEntry(
          importHistory.id,
          `Stage batch ${failedBatchNumber}`,
          error.message,
        );

        await this.htsImportService.appendLog(
          importHistory.id,
          `Stage batch ${failedBatchNumber} failed, retrying row-level fallback...`,
        );

        const fallbackResult = await this.processStageBatchRowByRow(
          importHistory,
          batch,
        );

        importedCount += fallbackResult.batchImported;
        updatedCount += fallbackResult.batchUpdated;
        skippedCount += fallbackResult.batchSkipped;
        failedCount += fallbackResult.batchFailed;
        processedCount += batch.length;
        batchNumber++;

        checkpoint.processedBatches = batchNumber;
        checkpoint.processedRecords = processedCount;
        await this.saveCheckpoint(importHistory.id, checkpoint);

        await this.htsImportService.updateCounters(importHistory.id, {
          importedEntries: importedCount,
          updatedEntries: updatedCount,
          skippedEntries: skippedCount,
          failedEntries: failedCount,
        });

        this.logger.warn(
          `Stage batch ${failedBatchNumber} recovered with row-level fallback: ` +
            `+${fallbackResult.batchImported} ~${fallbackResult.batchUpdated} ` +
            `=${fallbackResult.batchSkipped} !${fallbackResult.batchFailed}`,
        );
      }
    }

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
        `${failedCount.toLocaleString()} failed`,
    );
  }

  private async processStageBatchRowByRow(
    importHistory: HtsImportHistoryEntity,
    batch: HtsStageEntryEntity[],
  ): Promise<{
    batchImported: number;
    batchUpdated: number;
    batchSkipped: number;
    batchFailed: number;
  }> {
    let batchImported = 0;
    let batchUpdated = 0;
    let batchSkipped = 0;
    let batchFailed = 0;

    for (const staged of batch) {
      try {
        const result = await this.htsRepo.manager.transaction(
          async (transactionalEntityManager) =>
            this.processStagedEntry(
              staged,
              importHistory.sourceVersion,
              transactionalEntityManager,
            ),
        );

        if (result === 'CREATED') batchImported++;
        else if (result === 'UPDATED') batchUpdated++;
        else if (result === 'SKIPPED') batchSkipped++;
      } catch (rowError) {
        const rowErrorMessage =
          rowError instanceof Error ? rowError.message : String(rowError);
        batchFailed++;
        await this.htsImportService.addFailedEntry(
          importHistory.id,
          staged.htsNumber || 'UNKNOWN',
          rowErrorMessage || 'Unknown row error',
        );
        this.logger.error(
          `Failed staged row ${staged.htsNumber}: ${rowErrorMessage}`,
        );
      }
    }

    return {
      batchImported,
      batchUpdated,
      batchSkipped,
      batchFailed,
    };
  }

  /**
   * STAGE 2A: Preprocess + stage raw entries
   */
  private async stageFromS3(
    importHistory: HtsImportHistoryEntity,
    checkpoint: ImportCheckpoint,
  ): Promise<void> {
    const { s3Key, s3Bucket } = checkpoint;

    if (!s3Key || !s3Bucket) {
      throw new Error('S3 key and bucket not found in checkpoint');
    }

    await this.htsImportService.appendLog(
      importHistory.id,
      'Staging HTS entries...',
    );

    // Clear any previous staged data for this import (safe for retry)
    await this.htsStageDiffRepo.delete({ importId: importHistory.id });
    await this.htsStageIssueRepo.delete({ importId: importHistory.id });
    await this.htsStageRepo.delete({ importId: importHistory.id });

    const data = await this.loadSourceData(s3Bucket, s3Key);
    const totalEntries = this.countEntries(data);

    const chapters: Array<[string, any[]]> = Array.isArray(data)
      ? [['all', data]]
      : Object.entries(data.chapters || data);

    let processedCount = 0;
    let batchNumber = 0;
    const totalBatches = Math.ceil(totalEntries / this.BATCH_SIZE);

    this.logger.log(
      `Staging ${totalEntries} entries in ${totalBatches} batches of ${this.BATCH_SIZE}`,
    );

    for (const [, items] of chapters) {
      if (!Array.isArray(items)) continue;

      for (let i = 0; i < items.length; i += this.BATCH_SIZE) {
        const batch = items.slice(i, i + this.BATCH_SIZE);
        const stagedBatch = batch
          .map((item) => this.mapItemToStageEntry(item, importHistory))
          .filter((entry) => entry !== null);

        if (stagedBatch.length > 0) {
          await this.htsStageRepo.upsert(stagedBatch, [
            'importId',
            'htsNumber',
          ]);
        }

        processedCount += batch.length;
        batchNumber++;
        const percentComplete = Math.round(
          (processedCount / totalEntries) * 100,
        );

        if (batchNumber % 10 === 0) {
          await this.htsImportService.appendLog(
            importHistory.id,
            `Staging progress: ${processedCount.toLocaleString()}/${totalEntries.toLocaleString()} ` +
              `(${percentComplete}%) - Batch ${batchNumber}/${totalBatches}`,
          );
        }
      }
    }

    await this.htsImportService.appendLog(
      importHistory.id,
      `✓ Staging completed: ${totalEntries.toLocaleString()} entries staged`,
    );
  }

  /**
   * STAGE 2B: Validate staged entries
   */
  private async validateStagedEntries(
    importHistory: HtsImportHistoryEntity,
  ): Promise<{ errorCount: number; warningCount: number; infoCount: number }> {
    await this.htsImportService.appendLog(
      importHistory.id,
      'Validating staged entries...',
    );

    await this.htsStageIssueRepo.delete({ importId: importHistory.id });

    const total = await this.htsStageRepo.count({
      where: { importId: importHistory.id },
    });
    const pageSize = this.BATCH_SIZE;
    let processed = 0;
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    const formulaStats = {
      totalRateFields: 0,
      formulaResolvableCount: 0,
      formulaUnresolvedCount: 0,
      noteReferenceCount: 0,
      noteResolvedCount: 0,
      noteUnresolvedCount: 0,
      nonNoteResolvableCount: 0,
      nonNoteUnresolvedCount: 0,
    };
    const importYear = this.extractYear(importHistory.sourceVersion);

    for (let offset = 0; offset < total; offset += pageSize) {
      const batch = await this.htsStageRepo.find({
        where: { importId: importHistory.id },
        order: { htsNumber: 'ASC' },
        take: pageSize,
        skip: offset,
      });

      const issues: Array<Partial<HtsStageValidationIssueEntity>> = [];

      for (const entry of batch) {
        const htsNumber = entry.htsNumber;
        const chapter = entry.chapter;

        if (!htsNumber) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber: null,
            issueCode: 'MISSING_HTS_NUMBER',
            severity: 'ERROR',
            message: 'HTS number is missing',
          });
          errorCount++;
          continue;
        }

        if (!entry.description || entry.description.trim().length === 0) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'MISSING_DESCRIPTION',
            severity: 'WARNING',
            message: 'Description is missing',
          });
          warningCount++;
        }

        if (!chapter || chapter.length !== 2) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'INVALID_CHAPTER',
            severity: 'ERROR',
            message: `Chapter is invalid: "${chapter ?? ''}"`,
          });
          errorCount++;
        } else if (!htsNumber.replace(/\./g, '').startsWith(chapter)) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'CHAPTER_MISMATCH',
            severity: 'WARNING',
            message: `Chapter "${chapter}" does not match HTS prefix`,
          });
          warningCount++;
        }

        if (!/^[0-9.]+$/.test(htsNumber)) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'INVALID_HTS_FORMAT',
            severity: 'WARNING',
            message: 'HTS number contains unexpected characters',
          });
          warningCount++;
        }

        if (!this.isValidHtsNumberFormat(htsNumber)) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'INVALID_HTS_DOT_PATTERN',
            severity: 'WARNING',
            message: 'HTS number has unexpected dot placement or length',
          });
          warningCount++;
        }

        const digitOnly = htsNumber.replace(/\./g, '');
        if (
          entry.heading &&
          digitOnly.length >= 4 &&
          entry.heading !== digitOnly.substring(0, 4)
        ) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'HEADING_MISMATCH',
            severity: 'WARNING',
            message: `Heading "${entry.heading}" does not match HTS digits`,
          });
          warningCount++;
        }

        if (
          entry.subheading &&
          digitOnly.length >= 6 &&
          entry.subheading !== digitOnly.substring(0, 6)
        ) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'SUBHEADING_MISMATCH',
            severity: 'WARNING',
            message: `Subheading "${entry.subheading}" does not match HTS digits`,
          });
          warningCount++;
        }

        if (
          entry.statisticalSuffix &&
          digitOnly.length >= 8 &&
          entry.statisticalSuffix !==
            digitOnly.substring(0, entry.statisticalSuffix.length)
        ) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'STAT_SUFFIX_MISMATCH',
            severity: 'WARNING',
            message: `Statistical suffix "${entry.statisticalSuffix}" does not match HTS digits`,
          });
          warningCount++;
        }

        if (entry.generalRate && !this.isLikelyRate(entry.generalRate)) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'GENERAL_RATE_FORMAT',
            severity: 'WARNING',
            message: `General rate format looks unusual: "${entry.generalRate}"`,
          });
          warningCount++;
        } else if (entry.generalRate) {
          const classification = this.classifyRateType(entry.generalRate);
          if (classification.matches.length > 1) {
            issues.push({
              importId: importHistory.id,
              stageEntryId: entry.id,
              htsNumber,
              issueCode: 'GENERAL_RATE_AMBIGUOUS',
              severity: 'INFO',
              message: `General rate matches multiple types: ${classification.matches.join(', ')}`,
              details: classification,
            });
            infoCount++;
          }
        }

        const generalTypeValidation = this.validateRateByType(
          importHistory.id,
          entry,
          'generalRate',
          entry.generalRate,
        );
        if (generalTypeValidation.issues.length > 0) {
          issues.push(...generalTypeValidation.issues);
        }
        errorCount += generalTypeValidation.errorCount;
        warningCount += generalTypeValidation.warningCount;
        infoCount += generalTypeValidation.infoCount;

        const generalFormulaValidation =
          await this.validateRateFormulaReadiness(
            importHistory.id,
            entry,
            'generalRate',
            entry.generalRate,
            entry.unit,
            'general',
            importYear,
          );
        if (generalFormulaValidation.issues.length > 0) {
          issues.push(...generalFormulaValidation.issues);
        }
        errorCount += generalFormulaValidation.errorCount;
        warningCount += generalFormulaValidation.warningCount;
        infoCount += generalFormulaValidation.infoCount;
        this.mergeFormulaStats(formulaStats, generalFormulaValidation.stats);

        if (entry.special && !this.isLikelyRate(entry.special)) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'SPECIAL_RATE_FORMAT',
            severity: 'WARNING',
            message: `Special rate format looks unusual: "${entry.special}"`,
          });
          warningCount++;
        } else if (entry.special) {
          const classification = this.classifyRateType(entry.special);
          if (classification.matches.length > 1) {
            issues.push({
              importId: importHistory.id,
              stageEntryId: entry.id,
              htsNumber,
              issueCode: 'SPECIAL_RATE_AMBIGUOUS',
              severity: 'INFO',
              message: `Special rate matches multiple types: ${classification.matches.join(', ')}`,
              details: classification,
            });
            infoCount++;
          }
        }

        const specialTypeValidation = this.validateRateByType(
          importHistory.id,
          entry,
          'special',
          entry.special,
        );
        if (specialTypeValidation.issues.length > 0) {
          issues.push(...specialTypeValidation.issues);
        }
        errorCount += specialTypeValidation.errorCount;
        warningCount += specialTypeValidation.warningCount;
        infoCount += specialTypeValidation.infoCount;

        if (entry.other && !this.isLikelyRate(entry.other)) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'OTHER_RATE_FORMAT',
            severity: 'WARNING',
            message: `Other rate format looks unusual: "${entry.other}"`,
          });
          warningCount++;
        } else if (entry.other) {
          const classification = this.classifyRateType(entry.other);
          if (classification.matches.length > 1) {
            issues.push({
              importId: importHistory.id,
              stageEntryId: entry.id,
              htsNumber,
              issueCode: 'OTHER_RATE_AMBIGUOUS',
              severity: 'INFO',
              message: `Other rate matches multiple types: ${classification.matches.join(', ')}`,
              details: classification,
            });
            infoCount++;
          }
        }

        const otherTypeValidation = this.validateRateByType(
          importHistory.id,
          entry,
          'other',
          entry.other,
        );
        if (otherTypeValidation.issues.length > 0) {
          issues.push(...otherTypeValidation.issues);
        }
        errorCount += otherTypeValidation.errorCount;
        warningCount += otherTypeValidation.warningCount;
        infoCount += otherTypeValidation.infoCount;

        const otherFormulaValidation = await this.validateRateFormulaReadiness(
          importHistory.id,
          entry,
          'other',
          entry.other,
          entry.unit,
          'other',
          importYear,
        );
        if (otherFormulaValidation.issues.length > 0) {
          issues.push(...otherFormulaValidation.issues);
        }
        errorCount += otherFormulaValidation.errorCount;
        warningCount += otherFormulaValidation.warningCount;
        infoCount += otherFormulaValidation.infoCount;
        this.mergeFormulaStats(formulaStats, otherFormulaValidation.stats);

        if (entry.chapter99 && !this.isLikelyRate(entry.chapter99)) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'CHAPTER99_RATE_FORMAT',
            severity: 'WARNING',
            message: `Chapter 99 rate format looks unusual: "${entry.chapter99}"`,
          });
          warningCount++;
        } else if (entry.chapter99) {
          const classification = this.classifyRateType(entry.chapter99);
          if (classification.matches.length > 1) {
            issues.push({
              importId: importHistory.id,
              stageEntryId: entry.id,
              htsNumber,
              issueCode: 'CHAPTER99_RATE_AMBIGUOUS',
              severity: 'INFO',
              message: `Chapter 99 rate matches multiple types: ${classification.matches.join(', ')}`,
              details: classification,
            });
            infoCount++;
          }
        }

        const chapter99TypeValidation = this.validateRateByType(
          importHistory.id,
          entry,
          'chapter99',
          entry.chapter99,
        );
        if (chapter99TypeValidation.issues.length > 0) {
          issues.push(...chapter99TypeValidation.issues);
        }
        errorCount += chapter99TypeValidation.errorCount;
        warningCount += chapter99TypeValidation.warningCount;
        infoCount += chapter99TypeValidation.infoCount;

        const chapter99FormulaValidation =
          await this.validateRateFormulaReadiness(
            importHistory.id,
            entry,
            'chapter99',
            entry.chapter99,
            entry.unit,
            'general',
            importYear,
          );
        if (chapter99FormulaValidation.issues.length > 0) {
          issues.push(...chapter99FormulaValidation.issues);
        }
        errorCount += chapter99FormulaValidation.errorCount;
        warningCount += chapter99FormulaValidation.warningCount;
        infoCount += chapter99FormulaValidation.infoCount;
        this.mergeFormulaStats(formulaStats, chapter99FormulaValidation.stats);

        if (entry.indent < 0) {
          issues.push({
            importId: importHistory.id,
            stageEntryId: entry.id,
            htsNumber,
            issueCode: 'INVALID_INDENT',
            severity: 'ERROR',
            message: `Indent is negative: ${entry.indent}`,
          });
          errorCount++;
        }
      }

      if (issues.length > 0) {
        await this.htsStageIssueRepo.insert(issues);
      }

      processed += batch.length;
    }

    const formulaCoverage =
      formulaStats.totalRateFields > 0
        ? formulaStats.formulaResolvableCount / formulaStats.totalRateFields
        : 1;
    const formulaGatePassed =
      formulaCoverage >= this.MIN_STAGE_FORMULA_COVERAGE &&
      (this.ALLOW_UNRESOLVED_NOTE_FORMULAS ||
        formulaStats.noteUnresolvedCount === 0);

    const metadata = {
      ...(importHistory.metadata || {}),
      validationSummary: {
        total,
        errorCount,
        warningCount,
        infoCount,
        formulaCoverage,
        formulaGatePassed,
        validatedAt: new Date().toISOString(),
      },
      formulaValidationSummary: {
        ...formulaStats,
        minCoverage: this.MIN_STAGE_FORMULA_COVERAGE,
        currentCoverage: formulaCoverage,
        formulaGatePassed,
        noteFormulaPolicy: this.ALLOW_UNRESOLVED_NOTE_FORMULAS
          ? 'ALLOW_UNRESOLVED'
          : 'STRICT',
        validatedAt: new Date().toISOString(),
      },
    };

    await this.importHistoryRepo.update(importHistory.id, {
      metadata: metadata as any,
    });

    await this.htsImportService.appendLog(
      importHistory.id,
      `✓ Validation completed: ${processed.toLocaleString()} entries checked ` +
        `(errors: ${errorCount}, warnings: ${warningCount}, formula coverage: ${(formulaCoverage * 100).toFixed(2)}%)`,
    );

    return { errorCount, warningCount, infoCount };
  }

  private mergeFormulaStats(
    aggregate: {
      totalRateFields: number;
      formulaResolvableCount: number;
      formulaUnresolvedCount: number;
      noteReferenceCount: number;
      noteResolvedCount: number;
      noteUnresolvedCount: number;
      nonNoteResolvableCount: number;
      nonNoteUnresolvedCount: number;
    },
    current: {
      totalRateFields: number;
      formulaResolvableCount: number;
      formulaUnresolvedCount: number;
      noteReferenceCount: number;
      noteResolvedCount: number;
      noteUnresolvedCount: number;
      nonNoteResolvableCount: number;
      nonNoteUnresolvedCount: number;
    },
  ): void {
    aggregate.totalRateFields += current.totalRateFields;
    aggregate.formulaResolvableCount += current.formulaResolvableCount;
    aggregate.formulaUnresolvedCount += current.formulaUnresolvedCount;
    aggregate.noteReferenceCount += current.noteReferenceCount;
    aggregate.noteResolvedCount += current.noteResolvedCount;
    aggregate.noteUnresolvedCount += current.noteUnresolvedCount;
    aggregate.nonNoteResolvableCount += current.nonNoteResolvableCount;
    aggregate.nonNoteUnresolvedCount += current.nonNoteUnresolvedCount;
  }

  private async validateRateFormulaReadiness(
    importId: string,
    entry: HtsStageEntryEntity,
    issuePrefix: 'generalRate' | 'other' | 'chapter99',
    rawRate: string | null,
    unit: string | null,
    noteSourceColumn: 'general' | 'other' | 'special',
    year?: number,
  ): Promise<{
    issues: Array<Partial<HtsStageValidationIssueEntity>>;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    stats: {
      totalRateFields: number;
      formulaResolvableCount: number;
      formulaUnresolvedCount: number;
      noteReferenceCount: number;
      noteResolvedCount: number;
      noteUnresolvedCount: number;
      nonNoteResolvableCount: number;
      nonNoteUnresolvedCount: number;
    };
  }> {
    const issues: Array<Partial<HtsStageValidationIssueEntity>> = [];
    const rateText = this.normalizeString(rawRate || '');
    const stats = {
      totalRateFields: 0,
      formulaResolvableCount: 0,
      formulaUnresolvedCount: 0,
      noteReferenceCount: 0,
      noteResolvedCount: 0,
      noteUnresolvedCount: 0,
      nonNoteResolvableCount: 0,
      nonNoteUnresolvedCount: 0,
    };

    if (!rateText) {
      return { issues, errorCount: 0, warningCount: 0, infoCount: 0, stats };
    }

    stats.totalRateFields++;
    const issueCodePrefix = issuePrefix.toUpperCase();

    if (/note/i.test(rateText)) {
      stats.noteReferenceCount++;

      if (!this.noteResolutionService) {
        issues.push({
          importId,
          stageEntryId: entry.id,
          htsNumber: entry.htsNumber,
          issueCode: `${issueCodePrefix}_NOTE_SERVICE`,
          severity: 'WARNING',
          message: `${issuePrefix} references notes but NoteResolutionService is unavailable`,
          details: { rateText },
        });
        return { issues, errorCount: 0, warningCount: 1, infoCount: 0, stats };
      }

      const resolved = await this.noteResolutionService.resolveNoteReference(
        entry.htsNumber,
        rateText,
        noteSourceColumn,
        year,
        { exactOnly: true },
      );

      if (resolved?.formula) {
        stats.formulaResolvableCount++;
        stats.noteResolvedCount++;
        return { issues, errorCount: 0, warningCount: 0, infoCount: 0, stats };
      }

      stats.formulaUnresolvedCount++;
      stats.noteUnresolvedCount++;

      const severity = this.ALLOW_UNRESOLVED_NOTE_FORMULAS
        ? 'WARNING'
        : 'ERROR';
      issues.push({
        importId,
        stageEntryId: entry.id,
        htsNumber: entry.htsNumber,
        issueCode: `${issueCodePrefix}_NOTE_UNRESOLVED`,
        severity,
        message: `${issuePrefix} references note text but no note formula could be resolved`,
        details: { rateText, year, sourceColumn: noteSourceColumn },
      });

      return {
        issues,
        errorCount: severity === 'ERROR' ? 1 : 0,
        warningCount: severity === 'WARNING' ? 1 : 0,
        infoCount: 0,
        stats,
      };
    }

    const formulaCandidate =
      this.formulaGenerationService.generateFormulaByPattern(
        rateText,
        unit || undefined,
      );

    if (!formulaCandidate) {
      stats.formulaUnresolvedCount++;
      stats.nonNoteUnresolvedCount++;
      issues.push({
        importId,
        stageEntryId: entry.id,
        htsNumber: entry.htsNumber,
        issueCode: `${issueCodePrefix}_FORMULA_MISSING`,
        severity: 'ERROR',
        message: `${issuePrefix} could not be converted to a deterministic formula`,
        details: { rateText, unit },
      });
      return { issues, errorCount: 1, warningCount: 0, infoCount: 0, stats };
    }

    const validation = this.formulaGenerationService.validateFormula(
      formulaCandidate.formula,
    );
    if (!validation.valid) {
      stats.formulaUnresolvedCount++;
      stats.nonNoteUnresolvedCount++;
      issues.push({
        importId,
        stageEntryId: entry.id,
        htsNumber: entry.htsNumber,
        issueCode: `${issueCodePrefix}_FORMULA_INVALID`,
        severity: 'ERROR',
        message: `${issuePrefix} generated an invalid formula candidate`,
        details: {
          rateText,
          formula: formulaCandidate.formula,
          error: validation.error,
        },
      });
      return { issues, errorCount: 1, warningCount: 0, infoCount: 0, stats };
    }

    stats.formulaResolvableCount++;
    stats.nonNoteResolvableCount++;
    return { issues, errorCount: 0, warningCount: 0, infoCount: 0, stats };
  }

  private validateRateByType(
    importId: string,
    entry: HtsStageEntryEntity,
    issuePrefix: 'generalRate' | 'special' | 'other' | 'chapter99',
    rawRate: string | null,
  ): {
    issues: Array<Partial<HtsStageValidationIssueEntity>>;
    errorCount: number;
    warningCount: number;
    infoCount: number;
  } {
    const issues: Array<Partial<HtsStageValidationIssueEntity>> = [];
    const rateText = this.normalizeString(rawRate || '');

    if (!rateText) {
      return { issues, errorCount: 0, warningCount: 0, infoCount: 0 };
    }

    const issueCodePrefix = issuePrefix.toUpperCase();
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;

    const pushIssue = (
      severity: 'ERROR' | 'WARNING' | 'INFO',
      code: string,
      message: string,
      details?: Record<string, any>,
    ) => {
      issues.push({
        importId,
        stageEntryId: entry.id,
        htsNumber: entry.htsNumber,
        issueCode: `${issueCodePrefix}_${code}`,
        severity,
        message,
        details: details || null,
      });
      if (severity === 'ERROR') errorCount++;
      else if (severity === 'WARNING') warningCount++;
      else infoCount++;
    };

    const normalized = rateText.toLowerCase();

    if (/free/.test(normalized) && /[%$¢]|\d/.test(normalized)) {
      pushIssue(
        'WARNING',
        'MIXED_FREE_NUMERIC',
        `${issuePrefix} mixes "free" with numeric rate tokens`,
        { rateText },
      );
    }

    const rangeMatch = normalized.match(
      /(-?\d+(?:\.\d+)?)\s*%\s*(?:to|-)\s*(-?\d+(?:\.\d+)?)\s*%/,
    );
    if (rangeMatch) {
      const left = parseFloat(rangeMatch[1]);
      const right = parseFloat(rangeMatch[2]);
      if (left > right) {
        pushIssue(
          'ERROR',
          'RANGE_REVERSED',
          `${issuePrefix} has reversed percentage range`,
          {
            rateText,
            min: left,
            max: right,
          },
        );
      } else if (left === right) {
        pushIssue(
          'INFO',
          'RANGE_FLAT',
          `${issuePrefix} has identical range endpoints`,
          {
            rateText,
            value: left,
          },
        );
      }
    }

    const percentMatches = normalized.matchAll(
      /(-?\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/g,
    );
    for (const match of percentMatches) {
      const value = parseFloat(match[1]);
      if (value < 0) {
        pushIssue(
          'ERROR',
          'PERCENT_NEGATIVE',
          `${issuePrefix} has a negative percentage rate`,
          {
            rateText,
            value,
          },
        );
      } else if (value > 100 && value <= 500) {
        pushIssue(
          'WARNING',
          'PERCENT_HIGH',
          `${issuePrefix} has unusually high percentage rate`,
          { rateText, value },
        );
      } else if (value > 500) {
        pushIssue(
          'ERROR',
          'PERCENT_EXTREME',
          `${issuePrefix} has extreme percentage rate`,
          {
            rateText,
            value,
          },
        );
      }
    }

    const specificMatches = normalized.matchAll(
      /((?:\$|¢)?\s*-?\d+(?:\.\d+)?\s*(?:¢|cents?)?\s*(?:\/|per)\s*[a-z0-9.]+)/g,
    );
    for (const match of specificMatches) {
      const token = match[1];
      const numberMatch = token.match(/-?\d+(?:\.\d+)?/);
      if (!numberMatch) continue;
      let value = parseFloat(numberMatch[0]);
      if (token.includes('¢') || token.includes('cent')) {
        value = value / 100;
      }

      if (value < 0) {
        pushIssue(
          'ERROR',
          'SPECIFIC_NEGATIVE',
          `${issuePrefix} has a negative specific duty`,
          {
            rateText,
            token,
            value,
          },
        );
      } else if (value === 0) {
        pushIssue(
          'WARNING',
          'SPECIFIC_ZERO',
          `${issuePrefix} has a zero specific duty`,
          {
            rateText,
            token,
            value,
          },
        );
      } else if (value > 1000) {
        pushIssue(
          'WARNING',
          'SPECIFIC_HIGH',
          `${issuePrefix} has unusually high specific duty`,
          {
            rateText,
            token,
            value,
          },
        );
      }
    }

    if (
      /\bnote\b/.test(normalized) &&
      !/note[s]?\s+\d+[a-z]?(?:\([a-z0-9ivx]+\))*/i.test(rateText)
    ) {
      pushIssue(
        'WARNING',
        'NOTE_REFERENCE_AMBIGUOUS',
        `${issuePrefix} references notes without a parsable note number`,
        { rateText },
      );
    }

    return { issues, errorCount, warningCount, infoCount };
  }

  /**
   * STAGE 2C: Diff staged entries vs current active HTS + extra taxes
   */
  private async diffStagedEntries(
    importHistory: HtsImportHistoryEntity,
  ): Promise<void> {
    await this.htsImportService.appendLog(
      importHistory.id,
      'Diffing staged entries...',
    );

    await this.htsStageDiffRepo.delete({ importId: importHistory.id });

    const total = await this.htsStageRepo.count({
      where: { importId: importHistory.id },
    });
    const pageSize = this.BATCH_SIZE;

    for (let offset = 0; offset < total; offset += pageSize) {
      const stagedBatch = await this.htsStageRepo.find({
        where: { importId: importHistory.id },
        order: { htsNumber: 'ASC' },
        take: pageSize,
        skip: offset,
      });

      if (stagedBatch.length === 0) continue;

      const htsNumbers = stagedBatch.map((entry) => entry.htsNumber);
      const chapters = stagedBatch.map((entry) => entry.chapter);

      const currentBatch = await this.htsRepo.find({
        where: { htsNumber: In(htsNumbers), isActive: true },
      });

      const currentMap = new Map(
        currentBatch.map((entry) => [entry.htsNumber, entry]),
      );

      const extraTaxes = await this.loadExtraTaxes(htsNumbers, chapters);

      const diffs: Array<Partial<HtsStageDiffEntity>> = [];

      for (const staged of stagedBatch) {
        const current = currentMap.get(staged.htsNumber) || null;
        const applicableTaxes = this.matchExtraTaxes(
          extraTaxes,
          staged.htsNumber,
          staged.chapter,
        );

        const diffResult = this.computeDiff(current, staged, applicableTaxes);

        diffs.push({
          importId: importHistory.id,
          stageEntryId: staged.id,
          currentHtsId: current?.id || null,
          htsNumber: staged.htsNumber,
          diffType: diffResult.diffType,
          diffSummary: diffResult.diffSummary,
        });
      }

      if (diffs.length > 0) {
        await this.htsStageDiffRepo.insert(diffs);
      }
    }

    await this.diffRemovedEntries(importHistory);

    await this.htsImportService.appendLog(
      importHistory.id,
      '✓ Diffing completed',
    );
  }

  private async diffRemovedEntries(
    importHistory: HtsImportHistoryEntity,
  ): Promise<void> {
    const pageSize = this.BATCH_SIZE;

    for (let offset = 0; ; offset += pageSize) {
      const removedBatch = await this.htsRepo
        .createQueryBuilder('hts')
        .leftJoin(
          HtsStageEntryEntity,
          'stage',
          'stage.importId = :importId AND stage.htsNumber = hts.htsNumber',
          { importId: importHistory.id },
        )
        .where('hts.isActive = :isActive', { isActive: true })
        .andWhere('stage.id IS NULL')
        .orderBy('hts.htsNumber', 'ASC')
        .take(pageSize)
        .skip(offset)
        .getMany();

      if (removedBatch.length === 0) break;

      const extraTaxes = await this.loadExtraTaxes(
        removedBatch.map((entry) => entry.htsNumber),
        removedBatch.map((entry) => entry.chapter),
      );

      const diffs = removedBatch.map((entry) => ({
        importId: importHistory.id,
        stageEntryId: null,
        currentHtsId: entry.id,
        htsNumber: entry.htsNumber,
        diffType: 'REMOVED',
        diffSummary: {
          current: this.pickCurrentFields(entry),
          extraTaxes: this.matchExtraTaxes(
            extraTaxes,
            entry.htsNumber,
            entry.chapter,
          ),
        },
      }));

      await this.htsStageDiffRepo.insert(diffs);
    }
  }

  private async getValidationSummary(importId: string): Promise<{
    errorCount: number;
    warningCount: number;
    infoCount: number;
    formulaCoverage: number | null;
    formulaGatePassed: boolean;
  }> {
    const rows = await this.htsStageIssueRepo
      .createQueryBuilder('issue')
      .select('issue.severity', 'severity')
      .addSelect('COUNT(*)', 'count')
      .where('issue.importId = :importId', { importId })
      .groupBy('issue.severity')
      .getRawMany();

    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;

    for (const row of rows) {
      const count = parseInt(row.count, 10);
      if (row.severity === 'ERROR') errorCount = count;
      else if (row.severity === 'WARNING') warningCount = count;
      else if (row.severity === 'INFO') infoCount = count;
    }

    const importHistory = await this.importHistoryRepo.findOne({
      where: { id: importId },
    });
    const metadata = importHistory?.metadata || {};
    const metadataValidationSummary = metadata.validationSummary || {};
    const metadataFormulaSummary = metadata.formulaValidationSummary || {};
    const formulaCoverage =
      typeof metadataFormulaSummary.currentCoverage === 'number'
        ? metadataFormulaSummary.currentCoverage
        : typeof metadataValidationSummary.formulaCoverage === 'number'
          ? metadataValidationSummary.formulaCoverage
          : null;
    const formulaGateFlag =
      metadataFormulaSummary.formulaGatePassed ??
      metadataValidationSummary.formulaGatePassed;
    const formulaGatePassed =
      typeof formulaGateFlag === 'boolean' ? formulaGateFlag : errorCount === 0;

    return {
      errorCount,
      warningCount,
      infoCount,
      formulaCoverage,
      formulaGatePassed,
    };
  }

  private isValidHtsNumberFormat(htsNumber: string): boolean {
    const digitOnly = htsNumber.replace(/\./g, '');

    if (!/^\d+$/.test(digitOnly)) return false;

    if (![2, 4, 6, 8, 10].includes(digitOnly.length)) return false;

    if (htsNumber.includes('.')) {
      const patterns = [
        /^\d{4}\.\d{2}$/,
        /^\d{4}\.\d{2}\.\d{2}$/,
        /^\d{4}\.\d{2}\.\d{2}\.\d{2}$/,
      ];
      return patterns.some((pattern) => pattern.test(htsNumber));
    }

    return true;
  }

  private isLikelyRate(rateText: string): boolean {
    const value = this.normalizeString(rateText);

    if (value.length === 0) return true;

    const lower = value.toLowerCase();

    if (
      lower.includes('free') ||
      lower.includes('n/a') ||
      lower.includes('no') ||
      lower.includes('exempt') ||
      lower.includes('see') ||
      lower.includes('nil')
    ) {
      return true;
    }

    return this.matchesRatePattern(value);
  }

  private matchesRatePattern(value: string): boolean {
    const classification = this.classifyRateType(value);
    return classification.matches.length > 0;
  }

  private classifyRateType(value: string): {
    normalized: string;
    matches: string[];
  } {
    const normalized = value.replace(/\s+/g, ' ').trim();
    const matches: string[] = [];

    const patterns: Array<{ type: string; regex: RegExp }> = [
      { type: 'ad_valorem', regex: /^\d+(\.\d+)?%(\s*(ad\s+valorem|adv))?$/i },
      {
        type: 'specific_currency',
        regex: /^\$?\d+(\.\d+)?\s*(per|\/)\s*[a-zA-Z0-9.]+$/i,
      },
      {
        type: 'specific_unit',
        regex:
          /^\d+(\.\d+)?\s*(kg|lb|doz|pair|each|liter|l|m3|m2|no\.?|pcs?|sets?)$/i,
      },
      {
        type: 'cents_specific',
        regex: /^\d+(\.\d+)?\s*¢\s*(per|\/)?\s*[a-zA-Z0-9.]*$/i,
      },
      { type: 'compound', regex: /^.+\s*(\+|plus|and)\s*.+$/i },
      { type: 'range', regex: /^\d+(\.\d+)?%?\s*(to|-)\s*\d+(\.\d+)?%?$/i },
      { type: 'parenthetical', regex: /^.+\s*\([^)]*\)$/i },
      { type: 'preferential_free', regex: /^free\s*\([A-Z0-9,\s+\-*]+\)$/i },
      {
        type: 'preferential_rate',
        regex: /^\d+(\.\d+)?%\s*\([A-Z0-9,\s+\-*]+\)$/i,
      },
      { type: 'rate_or_specific', regex: /^.+\s*(or|\/|per)\s*.+$/i },
      { type: 'footnote', regex: /^.+\s*(note|see)\s*\d+.*$/i },
      { type: 'numeric', regex: /^\d+(\.\d+)?$/i },
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(normalized)) {
        matches.push(pattern.type);
      }
    }

    if (/%|\$/.test(normalized)) {
      if (!matches.includes('contains_rate_symbol')) {
        matches.push('contains_rate_symbol');
      }
    }

    return { normalized, matches };
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

    const htsNumber = item.htsNumber || item.hts_number || item.htsno;

    if (!htsNumber) {
      throw new Error('HTS number missing from entry');
    }

    // Check if entry exists for this version
    const existing = await entityManager.findOne(HtsEntity, {
      where: { htsNumber, version: sourceVersion },
    });

    if (existing) {
      // Update if changed
      const hasChanges = this.hasChanges(existing, item, sourceVersion);

      if (hasChanges) {
        await entityManager.update(
          HtsEntity,
          { htsNumber, version: sourceVersion },
          {
            ...this.mapItemToEntity(item, sourceVersion),
            updatedAt: new Date(),
          },
        );
        return 'UPDATED';
      } else {
        return 'SKIPPED';
      }
    } else {
      // Create new entry
      const entity = entityManager.create(
        HtsEntity,
        this.mapItemToEntity(item, sourceVersion),
      );
      await entityManager.save(HtsEntity, entity);
      return 'CREATED';
    }
  }

  /**
   * Process a staged entry into HTS
   */
  private async processStagedEntry(
    staged: HtsStageEntryEntity,
    sourceVersion: string,
    entityManager: any,
  ): Promise<'CREATED' | 'UPDATED' | 'SKIPPED'> {
    const htsNumber = staged.htsNumber;

    if (!htsNumber) {
      throw new Error('HTS number missing from staged entry');
    }

    const existing = await entityManager.findOne(HtsEntity, {
      where: { htsNumber, version: sourceVersion },
    });

    if (existing) {
      const hasChanges = this.hasStageChanges(existing, staged, sourceVersion);

      if (hasChanges) {
        await entityManager.update(
          HtsEntity,
          { htsNumber, version: sourceVersion },
          {
            ...this.mapStageToEntity(staged, sourceVersion),
            updatedAt: new Date(),
          },
        );
        return 'UPDATED';
      }

      return 'SKIPPED';
    }

    const entity = entityManager.create(
      HtsEntity,
      this.mapStageToEntity(staged, sourceVersion),
    );
    await entityManager.save(HtsEntity, entity);
    return 'CREATED';
  }

  /**
   * Check if entry has changes
   */
  private hasChanges(
    existing: HtsEntity,
    item: any,
    sourceVersion: string,
  ): boolean {
    const mapped = this.mapItemToEntity(item, sourceVersion);

    return (
      existing.sourceVersion !== sourceVersion ||
      existing.description !== mapped.description ||
      existing.unit !== mapped.unit ||
      existing.generalRate !== mapped.generalRate ||
      existing.parentHtsNumber !== mapped.parentHtsNumber ||
      existing.chapter !== mapped.chapter ||
      existing.indent !== mapped.indent
    );
  }

  private hasStageChanges(
    existing: HtsEntity,
    staged: HtsStageEntryEntity,
    sourceVersion: string,
  ): boolean {
    const mapped = this.mapStageToEntity(staged, sourceVersion);

    return (
      existing.sourceVersion !== sourceVersion ||
      existing.description !== mapped.description ||
      existing.unit !== mapped.unit ||
      existing.generalRate !== mapped.generalRate ||
      existing.special !== mapped.special ||
      existing.other !== mapped.other ||
      existing.chapter99 !== mapped.chapter99 ||
      JSON.stringify(existing.chapter99Links || []) !==
        JSON.stringify(mapped.chapter99Links || []) ||
      existing.footnotes !== mapped.footnotes ||
      existing.parentHtsNumber !== mapped.parentHtsNumber ||
      existing.chapter !== mapped.chapter ||
      existing.heading !== mapped.heading ||
      existing.subheading !== mapped.subheading ||
      existing.statisticalSuffix !== mapped.statisticalSuffix ||
      existing.indent !== mapped.indent
    );
  }

  /**
   * Map raw item to HTS entity
   */
  private mapItemToEntity(
    item: any,
    sourceVersion: string,
  ): Partial<HtsEntity> {
    const htsNumber = item.htsNumber || item.hts_number || item.htsno;
    const sourceFootnotes = item.footnotes || null;
    const chapter99Links = this.extractHtsCodesFromFootnotePayload(
      sourceFootnotes,
    ).filter((code) => code.startsWith('99'));

    return {
      htsNumber,
      version: sourceVersion, // Required NOT NULL field
      isActive: true,
      indent: item.indent || 0,
      description: item.description || '',
      unit: Array.isArray(item.units) ? item.units.join(', ') : item.unit || '',
      generalRate: item.generalRate || item.general_rate || item.general || '',
      specialRates:
        item.specialRates ||
        item.special_rates ||
        (item.special ? { default: item.special } : null),
      footnotes: this.normalizeFootnotePayload(sourceFootnotes),
      chapter99Links: chapter99Links.length > 0 ? chapter99Links : null,
      sourceVersion: sourceVersion,
      chapter: item.chapter || htsNumber?.substring(0, 2),
      parentHtsNumber:
        item.parentHtsNumber || item.parent_hts_number || item.superior || null,
      metadata: sourceFootnotes
        ? {
            sourceFootnotes,
          }
        : null,
    };
  }

  private mapStageToEntity(
    staged: HtsStageEntryEntity,
    sourceVersion: string,
  ): Partial<HtsEntity> {
    const sourceFootnotes = staged.rawItem?.footnotes || null;
    const chapter99Links = this.extractHtsCodesFromFootnotePayload(
      sourceFootnotes,
    ).filter((code) => code.startsWith('99'));

    return {
      htsNumber: staged.htsNumber,
      version: sourceVersion,
      isActive: true,
      indent: staged.indent,
      description: staged.description || '',
      unit: staged.unit || null,
      generalRate: staged.generalRate || null,
      general: staged.generalRate || null,
      special: staged.special || null,
      other: staged.other || null,
      specialRates: staged.special ? { default: staged.special } : null,
      chapter99: staged.chapter99 || null,
      chapter99Links: chapter99Links.length > 0 ? chapter99Links : null,
      footnotes: this.normalizeFootnotePayload(sourceFootnotes),
      sourceVersion,
      chapter: staged.chapter,
      heading: staged.heading || null,
      subheading: staged.subheading || null,
      statisticalSuffix: staged.statisticalSuffix || null,
      parentHtsNumber: staged.parentHtsNumber || null,
      importDate: new Date(),
      metadata: {
        sourceFootnotes,
        stagedNormalized: staged.normalized || null,
      },
    };
  }

  private mapItemToStageEntry(
    item: any,
    importHistory: HtsImportHistoryEntity,
  ): Partial<HtsStageEntryEntity> | null {
    const htsNumber = item.htsNumber || item.hts_number || item.htsno;

    if (!htsNumber) return null;

    const description = this.normalizeString(item.description || '');
    const unit = this.normalizeString(
      Array.isArray(item.units) ? item.units.join(', ') : item.unit || '',
    );
    const generalRate = this.normalizeString(
      item.generalRate || item.general_rate || item.general || '',
    );
    const special = this.normalizeString(item.special || '');
    const other = this.normalizeString(item.other || '');
    const chapter99 = this.normalizeString(
      item.chapter99 || item.chapter_99 || '',
    );
    const sourceFootnotes = item.footnotes || null;
    const chapter99Links = this.extractHtsCodesFromFootnotePayload(
      sourceFootnotes,
    ).filter((code) => code.startsWith('99'));
    const chapter = item.chapter || htsNumber?.substring(0, 2);
    const heading =
      item.heading ||
      (htsNumber ? htsNumber.replace(/\./g, '').substring(0, 4) : null);
    const subheading =
      item.subheading ||
      (htsNumber ? htsNumber.replace(/\./g, '').substring(0, 6) : null);
    const statisticalSuffix =
      item.statisticalSuffix ||
      item.statistical_suffix ||
      (htsNumber ? htsNumber.replace(/\./g, '').substring(0, 10) : null);

    const normalized = {
      htsNumber,
      description,
      unit,
      generalRate,
      special,
      other,
      chapter99,
      chapter99Links,
      chapter,
      heading,
      subheading,
      statisticalSuffix,
      parentHtsNumber:
        item.parentHtsNumber || item.parent_hts_number || item.superior || null,
      indent: item.indent || 0,
    };

    return {
      importId: importHistory.id,
      sourceVersion: importHistory.sourceVersion,
      htsNumber,
      indent: item.indent || 0,
      description: description || '',
      unit: unit || null,
      generalRate: generalRate || null,
      special: special || null,
      other: other || null,
      chapter99: chapter99 || null,
      chapter: chapter || '',
      heading: heading || null,
      subheading: subheading || null,
      statisticalSuffix: statisticalSuffix || null,
      parentHtsNumber:
        item.parentHtsNumber || item.parent_hts_number || item.superior || null,
      rowHash: this.computeRowHash(normalized),
      rawItem: item,
      normalized,
    };
  }

  private normalizeString(value: string | null | undefined): string {
    if (!value) return '';
    return value.toString().replace(/\s+/g, ' ').trim();
  }

  private normalizeFootnotePayload(payload: any): string | null {
    if (!payload) return null;
    if (typeof payload === 'string') {
      return this.normalizeString(payload) || null;
    }
    if (Array.isArray(payload)) {
      const chunks: string[] = [];
      for (const item of payload) {
        if (typeof item === 'string') {
          chunks.push(item);
          continue;
        }
        if (item && typeof item.value === 'string') {
          chunks.push(item.value);
        }
      }
      if (chunks.length === 0) {
        return JSON.stringify(payload);
      }
      return this.normalizeString(chunks.join(' ')) || null;
    }
    return this.normalizeString(JSON.stringify(payload)) || null;
  }

  private extractHtsCodesFromFootnotePayload(payload: any): string[] {
    const codes = new Set<string>();
    const texts: string[] = [];

    const collectCodes = (text: string) => {
      for (const match of text.matchAll(
        /\b(\d{4}\.\d{2}\.\d{2}(?:\.\d{2})?)\b/g,
      )) {
        codes.add(match[1]);
      }
    };

    if (typeof payload === 'string') {
      texts.push(payload);
    } else if (Array.isArray(payload)) {
      for (const item of payload) {
        if (typeof item === 'string') {
          texts.push(item);
        } else if (item && typeof item.value === 'string') {
          texts.push(item.value);
        }
      }
    } else if (payload) {
      texts.push(JSON.stringify(payload));
    }

    for (const text of texts) {
      collectCodes(text);
    }

    return Array.from(codes);
  }

  private computeRowHash(payload: Record<string, any>): string {
    const serialized = JSON.stringify(payload);
    return createHash('sha256').update(serialized).digest('hex');
  }

  private pickCurrentFields(current: HtsEntity): Record<string, any> {
    return {
      description: current.description,
      unit: current.unit,
      generalRate: current.generalRate,
      special: current.special,
      other: current.other,
      specialRates: current.specialRates,
      chapter99: current.chapter99,
      chapter99Links: current.chapter99Links,
      footnotes: current.footnotes,
      chapter: current.chapter,
      heading: current.heading,
      subheading: current.subheading,
      statisticalSuffix: current.statisticalSuffix,
      parentHtsNumber: current.parentHtsNumber,
      indent: current.indent,
    };
  }

  private pickStagedFields(staged: HtsStageEntryEntity): Record<string, any> {
    return {
      description: staged.description,
      unit: staged.unit,
      generalRate: staged.generalRate,
      special: staged.special,
      other: staged.other,
      chapter99: staged.chapter99,
      chapter99Links: Array.isArray(staged.normalized?.chapter99Links)
        ? staged.normalized.chapter99Links
        : [],
      footnotes: this.normalizeFootnotePayload(
        staged.rawItem?.footnotes || null,
      ),
      chapter: staged.chapter,
      heading: staged.heading,
      subheading: staged.subheading,
      statisticalSuffix: staged.statisticalSuffix,
      parentHtsNumber: staged.parentHtsNumber,
      indent: staged.indent,
    };
  }

  private computeDiff(
    current: HtsEntity | null,
    staged: HtsStageEntryEntity,
    extraTaxes: HtsExtraTaxEntity[],
  ): { diffType: string; diffSummary: Record<string, any> } {
    if (!current) {
      return {
        diffType: 'ADDED',
        diffSummary: {
          staged: this.pickStagedFields(staged),
          extraTaxes,
        },
      };
    }

    const currentFields = this.pickCurrentFields(current);
    const stagedFields = this.pickStagedFields(staged);
    const changes: Record<string, any> = {};

    for (const [key, stagedValue] of Object.entries(stagedFields)) {
      const currentValue = (currentFields as any)[key];
      if (this.haveDiffValueMismatch(key, currentValue, stagedValue)) {
        changes[key] = { current: currentValue, staged: stagedValue };
      }
    }

    const diffType = Object.keys(changes).length > 0 ? 'CHANGED' : 'UNCHANGED';

    return {
      diffType,
      diffSummary: {
        current: currentFields,
        staged: stagedFields,
        changes,
        extraTaxes,
      },
    };
  }

  private haveDiffValueMismatch(
    key: string,
    currentValue: unknown,
    stagedValue: unknown,
  ): boolean {
    const normalizedCurrent = this.normalizeDiffValue(key, currentValue);
    const normalizedStaged = this.normalizeDiffValue(key, stagedValue);
    return (
      this.stableSerialize(normalizedCurrent) !==
      this.stableSerialize(normalizedStaged)
    );
  }

  private normalizeDiffValue(key: string, value: unknown): unknown {
    if (key === 'chapter99Links') {
      const normalized = Array.isArray(value)
        ? value
            .map((entry) => (entry == null ? '' : String(entry).trim()))
            .filter((entry) => entry.length > 0)
        : [];
      return normalized.sort();
    }

    return value ?? null;
  }

  private stableSerialize(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableSerialize(entry)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([entryKey, entryValue]) =>
            `${JSON.stringify(entryKey)}:${this.stableSerialize(entryValue)}`,
        );
      return `{${entries.join(',')}}`;
    }

    return JSON.stringify(value);
  }

  private async loadExtraTaxes(
    htsNumbers: string[],
    chapters: string[],
  ): Promise<HtsExtraTaxEntity[]> {
    if (htsNumbers.length === 0) return [];

    return this.htsExtraTaxRepo
      .createQueryBuilder('tax')
      .where('tax.isActive = :isActive', { isActive: true })
      .andWhere(
        new Brackets((qb) => {
          qb.where('tax.htsNumber IN (:...htsNumbers)', { htsNumbers })
            .orWhere('tax.htsNumber IS NULL')
            .orWhere("tax.htsNumber = '*'");
        }),
      )
      .andWhere(
        new Brackets((qb) => {
          qb.where('tax.htsChapter IN (:...chapters)', { chapters }).orWhere(
            'tax.htsChapter IS NULL',
          );
        }),
      )
      .getMany();
  }

  private matchExtraTaxes(
    taxes: HtsExtraTaxEntity[],
    htsNumber: string,
    chapter: string,
  ): HtsExtraTaxEntity[] {
    return taxes.filter((tax) => {
      const matchesNumber =
        !tax.htsNumber || tax.htsNumber === '*' || tax.htsNumber === htsNumber;
      const matchesChapter = !tax.htsChapter || tax.htsChapter === chapter;
      return matchesNumber && matchesChapter;
    });
  }

  /**
   * Save checkpoint to database
   */
  private async saveCheckpoint(
    importId: string,
    checkpoint: ImportCheckpoint,
  ): Promise<void> {
    await this.importHistoryRepo.update(importId, {
      checkpoint: checkpoint as any,
    });
  }

  /**
   * Count total entries in dataset
   */
  private countEntries(data: any): number {
    this.logger.log(
      `🔢 countEntries called with type: ${Array.isArray(data) ? 'Array' : typeof data}`,
    );

    // Handle flat array format (USITC JSON)
    if (Array.isArray(data)) {
      this.logger.log(`🔢 Counted ${data.length} entries from flat array`);
      return data.length;
    }

    // Handle chapter-based format
    const chapters = data.chapters || data;
    let count = 0;

    for (const items of Object.values(chapters)) {
      if (Array.isArray(items)) {
        count += items.length;
      }
    }

    this.logger.log(`🔢 Counted ${count} entries from chapter-based format`);
    return count;
  }
}
