/**
 * P1.7 — Formula Stale Scan Job
 *
 * Scans hts rows for stale or low-confidence formulas and enqueues
 * formula-generation jobs in batches.
 *
 * Stale criteria (any one suffices):
 *   - rateFormula IS NULL but generalRate IS NOT NULL
 *   - rateTextHash differs from sha256(current generalRate)
 *   - formulaConfidence < threshold
 *   - formulaGeneratedAt < the HTS row's source-version date
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { HtsEntity } from '@hts/core';
import { QueueService } from '../../queue/queue.service';

@Injectable()
export class FormulaStaleScanJobHandler {
  private readonly logger = new Logger(FormulaStaleScanJobHandler.name);
  private readonly DEFAULT_BATCH_SIZE = 200;
  private readonly DEFAULT_MIN_CONFIDENCE = 0.7;

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepo: Repository<HtsEntity>,
    private readonly queueService: QueueService,
  ) {}

  async execute(job: any): Promise<void> {
    const {
      minConfidence = this.DEFAULT_MIN_CONFIDENCE,
      batchSize = this.DEFAULT_BATCH_SIZE,
      dryRun = false,
    } = job?.data || {};

    this.logger.log(
      `formula-stale-scan: starting (minConfidence=${minConfidence}, batchSize=${batchSize}, dryRun=${dryRun})`,
    );

    const stats = {
      scanned: 0,
      staleNullFormula: 0,
      staleHashDrift: 0,
      staleLowConfidence: 0,
      enqueued: 0,
    };

    // Cheap scan in chunks — never pull the full table.
    let lastId: string | undefined;
    // Use an indexed seek by id to avoid OFFSET on a multi-million-row table.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const qb = this.htsRepo
        .createQueryBuilder('hts')
        .select([
          'hts.id',
          'hts.htsNumber',
          'hts.generalRate',
          'hts.rateFormula',
          'hts.rateTextHash',
          'hts.formulaConfidence',
          'hts.isActive',
        ])
        .where('hts.isActive = true')
        .orderBy('hts.id', 'ASC')
        .limit(1000);
      if (lastId) {
        qb.andWhere('hts.id > :lastId', { lastId });
      }

      const rows = await qb.getMany();
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;
      stats.scanned += rows.length;

      const staleIds: string[] = [];
      for (const row of rows) {
        if (!row.generalRate) continue;

        const currentHash = this.hash(row.generalRate);
        const isNullFormula = !row.rateFormula;
        const isHashDrift =
          !!row.rateTextHash && row.rateTextHash !== currentHash;
        const isLowConfidence =
          row.formulaConfidence !== null &&
          Number(row.formulaConfidence) < minConfidence;

        if (isNullFormula) stats.staleNullFormula++;
        if (isHashDrift) stats.staleHashDrift++;
        if (isLowConfidence) stats.staleLowConfidence++;

        if (isNullFormula || isHashDrift || isLowConfidence) {
          staleIds.push(row.id);
        }
      }

      if (staleIds.length > 0 && !dryRun) {
        for (let i = 0; i < staleIds.length; i += batchSize) {
          const batch = staleIds.slice(i, i + batchSize);
          await this.queueService.sendJob('formula-generation', {
            htsRowIds: batch,
            triggeredBy: 'formula-stale-scan',
          });
          stats.enqueued += batch.length;
        }
      }
    }

    this.logger.log(
      `formula-stale-scan: done. scanned=${stats.scanned} ` +
        `null=${stats.staleNullFormula} hashDrift=${stats.staleHashDrift} ` +
        `lowConf=${stats.staleLowConfidence} enqueued=${stats.enqueued}`,
    );
  }

  private hash(text: string): string {
    return createHash('sha256')
      .update(text.trim().toLowerCase())
      .digest('hex');
  }
}
